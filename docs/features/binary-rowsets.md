# Binary Rowsets

Binary rowsets are the in-memory analytics path for very large arrays of flat
objects. They are not the same thing as the binary wire codec:

- `JIT.codec(schema)` serializes one value for transport or storage;
- `JIT.array(User).binary()` stores many rows in one reusable `ArrayBuffer`
  so queries can scan bytes directly.

Use this when a service receives thousands or millions of already trusted
records and needs to filter/project/aggregate them with minimal allocation.

## API

```ts
const User = JIT.object({
  id: JIT.number().int32(),
  name: JIT.string(),
  role: JIT.union(JIT.literal("admin"), JIT.literal("member")),
  active: JIT.boolean(),
  score: JIT.number().float32(),
  note: JIT.string().optional(),
});

const Users = JIT.array(User).binary({ strategy: "exact" });
const rowset = Users.load(bigArray);

const findAdmins = JIT.query(rowset)
  .filter((q) => q.and(q.eq("role", "admin"), q.eq("active", true)))
  .select("id", "name", "score")
  .compile();

const admins = findAdmins(rowset);
```

The default `memoryLayout: "auto"` keeps mixed rows packed and switches to
typed views when the existing field order is already naturally aligned. For
repeated scans and aggregates, select contiguous column storage explicitly:

```ts
const AnalyticalUsers = JIT.array(User).binary({
  strategy: "static",
  memoryLayout: "columnar",
  capacity: 1_000_000,
});
```

For an end-to-end object → bytes → result pipeline:

```ts
const pipeline = JIT.process(User)
  .binary({ strategy: "exact" })
  .filter((q) => q.eq("active", true))
  .select("id", "role")
  .compile();

const result = pipeline.execute(bigArray);
```

When the length is known but the input object is an iterator wrapper or a
pre-sized window, pass it explicitly:

```ts
pipeline.execute(batch, batchLength);
```

## Memory Strategies

`strategy: "exact"` allocates the exact calculated byte length for the current
batch. Row layouts use `rowSize * length`; columnar layouts add only the
alignment bytes needed between entire columns. It is the best default for HTTP
payloads, database pages, and queue batches where the array length is known
before processing.

```ts
JIT.array(User).binary({ strategy: "exact" });
```

`strategy: "dynamic"` keeps one scratch buffer and grows it geometrically when
larger batches arrive. It is zero-config and avoids repeated allocations once
the buffer has reached the normal high-water mark.

```ts
JIT.array(User).binary({
  strategy: "dynamic",
  initialBytes: 8 * 1024 * 1024,
});
```

`strategy: "static"` uses a fixed row capacity or a caller-provided buffer. It
is the lowest-jitter server mode because the buffer is allocated once and
capacity overflow fails loudly.

```ts
const Users = JIT.array(User).binary({
  strategy: "static",
  capacity: 100_000,
});

const WithCallerMemory = JIT.array(User).binary({
  strategy: "static",
  buffer: new ArrayBuffer(64 * 1024 * 1024),
});
```

## Layout

The rowset compiler accepts flat object schemas with scalar fields:

- `number`, `.float32()`, `.int32()`;
- `boolean`;
- `bigint`;
- `date`;
- `string`;
- `enum`;
- unions/xors made only of string or number literals;
- `literal`, `null`, `undefined`;
- optional and nullable wrappers around those fields.

Each row has a fixed byte width. Optional and nullable fields use a compact
2-bit state in a per-row bitmask:

- `00` = `undefined`;
- `01` = `null`;
- `10` = present.

Strings and literal unions use per-field dictionaries. A filter such as
`q.eq("role", "admin")` resolves `"admin"` to an integer code once, before
the loop, and the hot path compares that compact code in the row buffer
(`uint8` for small fixed dictionaries, `uint32` for larger/dynamic ones).

### Memory Layouts

`memoryLayout: "auto"` is the default. The compiler first calculates the
zero-padding packed layout. If every 4-byte and 8-byte field, plus the row
stride itself, is naturally aligned, the generated hot path uses
`Int32Array`, `Uint32Array`, `Float32Array`, `Float64Array`, and
`BigInt64Array`. Otherwise it keeps the smaller packed row and uses `DataView`
for wide values.

`memoryLayout: "packed"` always preserves declaration order with no padding.
It minimizes buffer size and usually wins mixed byte/number scans because more
rows fit in each cache line.

`memoryLayout: "aligned"` places the mask first, then 1-byte, 4-byte, and
8-byte lanes. The public object property order does not change. Each wide field
and row stride is naturally aligned, so generated code can use direct typed
array indexing. A caller-provided `Uint8Array` must have a byte offset matching
`layout.alignment`; a misaligned static buffer fails during compilation.

`memoryLayout: "columnar"` keeps the same single `ArrayBuffer`, but stores each
field as one contiguous typed column. Optional masks occupy the leading bytes;
the remaining columns are aligned once per column, not once per row. Generated
queries load the required column bases from `rowset.offsets` before the loop and
then read `columnBase + i`. This is the strongest mode for repeated filters,
counts, sums, and queries that touch a small subset of a wide schema.

Columnar mode is explicit because row order is usually better for one-pass
hydration and because `auto` cannot know how many times an application will
reuse a batch. It supports `exact`, `dynamic`, `static`, caller buffers,
optionals/nullables, dictionaries, 32/64-bit values, hydration, JIT queries,
and import-free AOT queries.

Inspect the decision without reading generated source:

```ts
console.log(AnalyticalUsers.layout.memoryLayout); // "columnar"
console.log(AnalyticalUsers.layout.rowSize); // logical bytes per value
console.log(AnalyticalUsers.layout.paddingBytes);
console.log(AnalyticalUsers.layout.fields);
```

The rowset object keeps one stable property shape for exact, dynamic, and
static strategies. Unused typed-view properties point to shared empty views;
`release()` replaces references instead of deleting properties. This keeps
the call sites that consume rowsets monomorphic.

### Adaptive Projection Strings

`JIT.process()` knows the complete filter/projection plan before it creates the
binary loader. A dynamic string used only in the output is marked adaptive:
the loader samples up to 1,024 present values. At 50% or higher uniqueness it
stores identity codes and row string references directly, skipping the large
`Map<string, code>` construction. Low-cardinality fields retain canonical
dictionaries.

```ts
const projectUsers = JIT.process(User)
  .binary({ strategy: "dynamic", memoryLayout: "columnar" })
  .filter((q) => q.eq("role", "admin")) // indexed integer dictionary
  .select("id", "name") // unique name can use identity codes
  .compile();
```

This optimization is deliberately plan-scoped. A string used by any filter is
always indexed and compared as an integer. A standalone
`JIT.array(User).binary().load()` also builds complete dictionaries because it
cannot know which future queries will need string equality. The adaptive
branch is chosen once before the generated writer loop and remains stable for
the whole batch.

## Why It Is Faster

Regular JS array filtering repeatedly loads object properties from the heap.
For large arrays that means pointer chasing, many object shapes, and a lot of
GC-visible state.

Binary rowsets change the hot loop:

- one `ArrayBuffer` represents the full batch;
- fixed offsets replace dynamic property lookup;
- enums, literal unions, and booleans are normalized to integers before the
  loop, so the loop does not compare strings or convert booleans;
- naturally aligned layouts read wide values through specialized typed views;
  compact mixed layouts retain `DataView` when padding would cost more;
- columnar layouts keep each scanned field contiguous and remove row-stride
  cursor math from generated loops;
- filters and projections are fused into one generated loop;
- filtered numeric aggregates cache a field read once per row and `sum` uses
  conditional accumulation instead of a callback or intermediate array;
- process plans avoid building high-cardinality string maps for fields that
  are proven to be projection-only;
- rows that fail the filter are never hydrated back into JS objects.

That is why the byte-query path is especially strong for selective filters:
the engine scans compact memory and only allocates the projected output rows.

## Why It Uses Less Memory

`load()` turns many JS objects into one contiguous byte block plus small
dictionaries for unique strings. The GC tracks one large buffer instead of
every intermediate filter/map array.

`JIT.query(rowset)` hydrates only rows that pass the filter and only the
selected fields:

```ts
JIT.query(rowset)
  .filter((q) => q.eq("active", true))
  .select("id", "score")
  .compile();
```

The output contains `{ id, score }` objects only for matching rows. No full
`User` objects are reconstructed unless you call `rowset.hydrate()`.

## Cache And Lifecycle

The generated loader, hydrator, and byte-query source are cached per schema
and query shape. Query bindings are applied to a cached source template, so
runtime values do not leak into shared closures.

For dynamic/static rowsets, the compiled binary loader owns scratch memory.
Each `load()` returns a view over that scratch memory; hydrate or consume it
before the next `load()` on the same binary loader if you need stable data.
Use `exact` when multiple rowsets must stay alive at the same time. Call
`binary.clear()` when a long-lived process wants to release the scratch
buffer. Call `rowset.release()` when you are done with one rowset view and
want to drop its direct references to the buffer.

```ts
const binary = JIT.array(User).binary({ strategy: "dynamic" });
const rowset = binary.load(users);

consume(rowset);

rowset.release();
binary.clear();
```

## AOT And Tree Sharing

Binary queries register source artifacts like normal compiled queries. If a
dev exports one as a standalone function or puts it inside a grouped
`JIT.compile(schema, { ... })` object, `jit generate` can re-emit the byte
scanner as plain JS.

```ts
export const ActiveAdmins = JIT.query(Users.binary().load(seed))
  .filter((q) => q.eq("role", "admin"))
  .select("id", "score")
  .compile();
```

Generated output contains the specialized `function query(rowset)` body and
no import from `jit`. The query source declares only the typed views and string
dictionaries touched by its filters, projection, and aggregate. An `id`/`score`
query cannot retain the `note` dictionary by accident. On the front end this
matters: pages that import only that generated query do not ship validators,
codecs, schema builders, the runtime compiler, or unused rowset helpers.

## Benchmarks

```sh
pnpm bench:binary
pnpm bench:binary-strings
pnpm bench:report
```

The binary suite measures:

- preloaded byte query over 10k, 100k, and 1M rows;
- allocation-free `count` and `sum` scans;
- packed, forced-aligned, and columnar layouts over the same data;
- isolated layout conversion (`load`) at 100k and 1M rows;
- full `load + query` pipelines with exact and dynamic strategies;
- regular `JIT.query` over JS arrays;
- handwritten JS filter/map as a marked biased baseline;
- Zod 4 and TypeBox validation plus native filter/map as marked biased
  boundary comparisons.

The string strategy suite separately measures dictionary versus fixed UTF-8
hash slots at low, medium, and unique cardinalities, including exact byte
verification and hydration.

Mitata persists `heap/op` and GC stats in `bench/results/binary.latest.json`.
Use those numbers to decide between `exact`, `dynamic`, and `static` for a
real workload.

Latest local run in this repo on Node 22.17.1, linux-x64, Ryzen 7 5800H:

| Scenario                           | Best rowset result                         | Same-run comparison                        |
| ---------------------------------- | ------------------------------------------ | ------------------------------------------ |
| Preloaded selective projection, 1M | **columnar: 15.04 ms / 13.62 MiB heap/op** | aligned: 15.26 ms; packed: 16.89 ms        |
| Filtered `count`, 1M               | **columnar: 1.09 ms / 96 B**               | packed: 1.38 ms; JIT JS array: 4.24 ms     |
| Filtered `sum`, 1M                 | **columnar: 1.26 ms / 96 B**               | aligned: 1.68 ms; packed: 2.31 ms          |
| Generic isolated `load`, 1M        | **columnar: 463.41 ms / 90.21 MiB**        | aligned: 480.78 ms; packed: 482.90 ms      |
| Adaptive `load+query`, 1M, exact   | **columnar: 63.36 ms / 29.49 MiB**         | aligned: 65.97 ms; packed: 67.40 ms        |
| Adaptive `load+query`, 1M, dynamic | **packed: 52.67 ms / 28.26 MiB**           | Zod parse + native: 454.89 ms / 110.31 MiB |

The table is intentionally split: preloaded rowsets measure the byte scanner;
`load+query` measures conversion plus compute. If a workload runs one simple
filter over an already materialized JS array, normal `JIT.query` may be
faster. If the same batch feeds repeated filters, aggregations, or controlled
scratch-memory stages, rowsets keep the data compact between operations.

### Optimization Record

The baseline captured before this work used only packed `DataView` reads. On
the same machine it measured 1.50 ms for the 1M filtered count, 2.67 ms for the
filtered sum, 413.71 ms for exact load+query, and 424.66 ms for dynamic
load+query. Integer boolean comparisons, single-read aggregate specialization,
and adaptive row layout first brought the comparable results to 1.39 ms, 1.51
ms, 403.32 ms, and 402.34 ms respectively. Columnar storage then reduced the
same allocation-free scans to 1.07 ms and 1.28 ms while remaining competitive
for one-pass load+query.

The next bottleneck was not byte scanning but building maps for unique `name`
values. Plan-scoped adaptive strings reduced the 1M dynamic load+query flow
from roughly 403 ms / 81 MiB to 52.67 ms / 28.26 MiB. Generic `binary.load()`
intentionally remains around 463-483 ms in this fixture because it prepares
all dynamic strings for arbitrary future equality queries.

The dedicated 300k-string benchmark explains the threshold. At cardinality
32, dictionary load was 3.48 ms versus 31.46 ms inline and equality was 0.22
ms versus 0.74 ms. With 300k unique values, inline load won 34.32 ms versus
81.17 ms and used far less heap, but inline hydration took 46.67 ms versus
1.88 ms. Therefore fixed inline UTF-8 is not a default; adaptive identity
codes capture the high-cardinality load/memory benefit while preserving fast
dictionary hydration and exact integer filters where required.

Forcing every row to be aligned was tested and rejected as the default. It
changed the benchmark schema from 19 to 20 bytes per row. Typed reads helped
numeric aggregation and selective projection, but the wider stride hurt the
byte-heavy count and added one MiB per million rows. This is why `auto` does
not inject padding into a mixed schema merely because an aligned read sounds
faster in isolation.

Heap-per-operation for projecting queries includes result object allocation
and GC timing, so compare repeated runs. Physical rowset storage is
deterministic: `rowSize * count` for row layouts; columnar adds at most a few
alignment bytes between full columns. In this fixture that is 19,000,000 bytes
packed/columnar or 20,000,000 bytes aligned per million rows, plus dictionaries
and the small column-offset table.

## Current Limits

The first rowset layout intentionally supports flat scalar objects. Nested
arrays, maps, records, arbitrary unions, transforms, and callbacks still use
the normal JIT validators/queries. This keeps the binary hot path honest:
when JIT says a rowset query scans bytes, it really scans bytes with fixed
offsets instead of silently falling back to generic object interpretation.

The next measured storage stage is a hybrid/indexed plan for repeated equality
and range filters. An explicit bounded inline UTF-8 mode remains a possible
niche for data that is loaded but never hydrated; it will not be inferred
blindly from `.max()`. Discriminated object unions need a numeric type tag and
separate branch layouts; intersections can be flattened only when overlapping
fields have compatible physical representations.
