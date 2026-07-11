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

`strategy: "exact"` allocates exactly `rowSize * length` bytes for the current
batch. It is the best default for HTTP payloads, database pages, and queue
batches where the array length is known before processing.

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

## Why It Is Faster

Regular JS array filtering repeatedly loads object properties from the heap.
For large arrays that means pointer chasing, many object shapes, and a lot of
GC-visible state.

Binary rowsets change the hot loop:

- one `ArrayBuffer` represents the full batch;
- fixed offsets replace dynamic property lookup;
- booleans, int32, float32, float64, dates, and dictionary codes are read with
  `Uint8Array`/`DataView`;
- filters and projections are fused into one generated loop;
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
no import from `jit`. On the front end this matters: pages that import only
that generated query do not ship validators, codecs, schema builders, or the
runtime compiler.

## Benchmarks

```sh
pnpm bench:binary
pnpm bench:report
```

The binary suite measures:

- preloaded byte query over 10k, 100k, and 1M rows;
- full `load + query` pipelines with exact and dynamic strategies;
- regular `JIT.query` over JS arrays;
- handwritten JS filter/map as a marked biased baseline;
- Zod 4 and TypeBox validation plus native filter/map as marked biased
  boundary comparisons.

Mitata persists `heap/op` and GC stats in `bench/results/binary.latest.json`.
Use those numbers to decide between `exact`, `dynamic`, and `static` for a
real workload.

Latest local run in this repo on Node 22.17.1, linux-x64, Ryzen 7 5800H:

| Scenario                               | JIT binary            | Comparison                       |
| -------------------------------------- | --------------------- | -------------------------------- |
| Preloaded query, 100k users            | **844.90 µs / 1.32 MB** | JIT JS-array query: 982.38 µs / 1.32 MB |
| Preloaded query, 1M users              | **13.67 ms / 11.13 MB** | JIT JS-array query: 16.55 ms / 11.06 MB |
| `load+query`, 100k users, dynamic pool | **17.64 ms / 7.89 MB** | Zod 4 parse + native filter: 40.31 ms / 11.56 MB |
| `load+query`, 1M users, exact          | **412.10 ms / 78.20 MB** | Zod 4 parse + native filter: 444.44 ms / 107.75 MB |

The table is intentionally split: preloaded rowsets measure the byte scanner;
`load+query` measures conversion plus compute. If a workload runs one simple
filter over an already materialized JS array, normal `JIT.query` may be
faster. If the same batch feeds repeated filters, aggregations, or controlled
scratch-memory stages, rowsets keep the data compact between operations.

## Current Limits

The first rowset layout intentionally supports flat scalar objects. Nested
arrays, maps, records, arbitrary unions, transforms, and callbacks still use
the normal JIT validators/queries. This keeps the binary hot path honest:
when JIT says a rowset query scans bytes, it really scans bytes with fixed
offsets instead of silently falling back to generic object interpretation.
