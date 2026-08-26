# Indexing

`JIT.index` materializes an index over a collection from the key the collection
already declares. It is the operation half of the schema facts — `.keyed()`,
`.indexBy()`, `.uniqueBy()` and entity identity describe intent, and
`IndexDescriptor` turns that intent into a physical access path that lookup,
join and reconcile all read.

## 1. Problem

Building an index is four lines, which is why it is written again in every
module that needs one, and why the same three defects keep appearing:

```ts
// The key is a string, so a typo is `undefined` for every row and the index
// silently collapses to a single entry.
const byId = new Map(rows.map((row) => [row[key], row]));

// A Date key matches by identity, so this index can never be hit.
const byDate = new Map(rows.map((row) => [row.createdAt, row]));

// Rebuilt on every call, because there is nowhere obvious to keep it.
function find(rows, id) {
  return new Map(rows.map((row) => [row.id, row])).get(id);
}
```

The third one is the expensive one: an index rebuilt per lookup is strictly
worse than the linear scan it replaced.

## 2. Why JIT

The collection already carries the answer:

- `.keyed("id")` states the key **and** that it is unique;
- `.indexBy("email")` states an equality-access intent;
- `.uniqueBy("sku")` states uniqueness without an index intent;
- an entity hint states identity.

From those the compiler reads which key to use, whether it needs a timestamp
rather than a `Date` object, and whether absent values are possible. It also
gives every plan a stable identity, which is what makes a shared cache safe:
two different plans over the same array no longer evict each other.

## 3. API

```ts
const Users = JIT.array(User).keyed("id");

const byId = JIT.index(Users); // key inferred from .keyed
const byEmail = JIT.index(Users).by("email"); // explicit key
const byTenantEmail = JIT.index(Users).by("tenantId", "email"); // compound
const perTenant = JIT.index(Users).by("tenantId").grouped(); // every row

const index = byId(users); // built fresh
const shared = byId.cached(users); // built once per array
```

`by()` overrides the inferred key and is what gives the index a precise type;
the inferred form types its keys as `unknown`, because the fact lives in the
schema value rather than in the type. `grouped()` is available on both.

## 4. Semantics

- The callable **builds a new index on every call**. Nothing is cached unless
  `cached` is used.
- `cached(rows)` returns one index per `(array reference, plan)` pair, held in a
  `WeakMap`. It is valid only while that array's contents are: an array mutated
  in place keeps its stale index. Build fresh when in doubt.
- A unique index keeps the **last** row for a key. Facts are not enforced at
  runtime: `.keyed("id")` on data with duplicate ids yields the last one.
- `grouped()` keeps every row per key, in input order.
- Compound keys produce nested maps, one level per key.
- A `Date` key is indexed by `getTime()`, so lookups take a timestamp.
- An absent key value (`null`/`undefined`) is a normal key and gets its own
  entry; it is not skipped.
- A collection with no key fact throws when built. `.by()` still works on it.
- Keys must resolve to statically comparable scalars, and must not repeat.

## 5. Compilation

```text
collection schema + facts (or explicit keys)
      ↓  resolveIndexDescriptor
IndexDescriptor      keys[{ key, valueKind, nullish }], shape, uniqueByFact
      ↓  emitIndexBuilder
builder source + cache key
      ↓
JIT.index · (future) lookup, join, reconcile
```

`resolveRowObjectSchema` and `resolveScalarKeyKind` are shared with ordering, so
a key means the same thing to a comparator and to an index. Where they differ is
deliberate: ordering has a `numeric` fast path for subtraction, while a `Map`
matches keys with SameValueZero, so indexing folds `numeric` into `direct`.

The descriptor lives on the artifact record, never on the compiled plan — an
AOT plan that embedded a descriptor would be carrying the compiler with it.

## 6. Generated code

Single inferred key:

```js
const build = (value) => {
  const index = new Map();
  const len = value.length;
  for (let i = 0; i < len; i++) {
    const row = value[i];
    const key0 = row.id;
    index.set(key0, row);
  }
  return index;
};
```

Compound keys walk one level per key, creating levels on the way:

```js
const key0 = row.tenantId;
const key1 = row.email;
let level1 = index.get(key0);
if (level1 === undefined) {
  level1 = new Map();
  index.set(key0, level1);
}
level1.set(key1, row);
```

Grouped keeps the bucket, appending by index rather than through `push`:

```js
const group = index.get(key0);
if (group === undefined) {
  index.set(key0, [row]);
} else {
  group[group.length] = row;
}
```

No `Object.keys`, no key array, no dynamic property read, no per-row closure.

## 7. Allocation model

| Allocation             | `plan(rows)`             | `plan.cached(rows)` (hit) |
| ---------------------- | ------------------------ | ------------------------- |
| `Map`                  | 1 per key level          | 0                         |
| group arrays           | 1 per key, grouped only  | 0                         |
| per-row temporaries    | 0                        | 0                         |
| composite key strings  | 0 — levels nest instead  | 0                         |

Compound keys deliberately do not concatenate a composite string key. A
concatenated key would allocate a string per row and would need an escaping
rule for the separator; nesting allocates one `Map` per distinct prefix and
stays exact.

## 8. Complexity

Building is `O(n)` and one pass. What indexing changes is what happens after:

```text
scan per lookup:        O(n) per lookup
build per lookup:       O(n) per lookup, worse constant than the scan
cached index:           O(n) once, then O(1) per lookup
```

That third line is the whole point of the operation, and the only complexity
claim this page makes.

## 9. Physical strategies

Today one strategy is emitted: a hash index, unique or grouped, nested per key.
The descriptor carries `uniqueByFact` and the key kinds so that the strategies
planned around it can choose without re-deriving facts:

- a lookup against an `.ordered()` unique key can binary-search instead;
- a small collection can be scanned rather than indexed — the equality compiler
  already switches at 64 items, and that threshold moves into the planner;
- a join can reuse an index the query already built rather than hashing again.

None of those are implemented yet, and none are claimed here.

## 10. AOT

`JIT.index` exists with the same signature on `@jit-compiler/jit/define`, where
the plan is a non-executable stub carrying the same descriptor. A definition
file with no key fact and no `.by()` fails at declaration rather than at
generation.

Generated output is a self-contained builder plus one shared cache helper:

```js
const __planCache = new WeakMap();
function __cachedIndex(items, cacheKey, build) {
  let plans = __planCache.get(items);
  if (plans === undefined) { plans = new Map(); __planCache.set(items, plans); }
  const cached = plans.get(cacheKey);
  if (cached !== undefined) return cached;
  const built = build(items);
  plans.set(cacheKey, built);
  return built;
}
const byId = /*#__PURE__*/ ((__cache) => {
  const build = (value) => {
    const index = new Map();
    const len = value.length;
    for (let i = 0; i < len; i++) {
      const row = value[i];
      const key0 = row.id;
      index.set(key0, row);
    }
    return index;
  };
  const cached = (value) => __cache(value, "index:unique:id:direct:false", build);
  Object.defineProperty(build, "cached", { value: cached });
  return build;
})(__cachedIndex);
```

The cache helper is emitted only when an index plan is generated, and it is the
one piece of shared state in the module.

## 11. Runtime/AOT parity

- one API: `JIT.index` on runtime and define;
- the parity case in `src/__tests__/entrypoints.test.ts` builds the same index
  through both hosts and compares the result;
- compound and grouped emission are covered by deterministic snapshots;
- a tree-shaking fixture proves an index plan pulls in no other compiler and no
  neighbouring artifact.

## 12. Benchmarks

```text
Command      pnpm bench:index
Source       bench/index/index.ts
Environment  Node 22.22.3, Apple M1, darwin-arm64
Captured     2026-08-26
```

### Building an index

Times are µs per full build; lower is better.

| Scenario                          | Handwritten | JIT runtime | JIT AOT | Heap/build |
| --------------------------------- | ----------: | ----------: | ------: | ---------: |
| unique / 100                      |        1.80 |        1.82 |    1.80 |      ~3 kb |
| unique / 1 000                    |       17.72 |       17.53 |   17.92 |          — |
| unique / 10 000                   |      453.93 |      460.77 |  453.45 |     921 kb |
| unique / 100 000                  |    4 999.62 |    5 049.45 | 5 165.93 |   4 632 kb |
| grouped / 10 000 rows, 100 groups |      172.54 |      173.42 |  170.92 |     252 kb |
| date key / 10 000                 |      562.71 |      581.46 |  589.69 |     921 kb |
| compound / 10 000                 |      718.98 |      764.69 |  736.54 |     726 kb |

**Building an index is at parity with handwritten code, not faster than it.**
It is dominated by `Map.set`, which no amount of specialization changes, and
the heap figures are identical because the same maps get allocated. This page
does not claim a construction speedup.

### Reusing an index

One lookup into a 10 000-row collection:

| Approach                       |    Time | Heap/op | vs cached |
| ------------------------------ | ------: | ------: | --------: |
| `plan.cached(rows).get(id)`    | 68.5 ns |   301 b |        1x |
| `plan(rows).get(id)` (rebuild) | 456 µs  |  921 kb |  6 650x slower |
| linear scan                    | 5.13 µs |    86 b |     75x slower |

The linear scan is marked not comparable in the harness: for a *single* lookup
it does less work than building anything, and it is listed to show the shape a
cached index has to beat before it earns its memory. It does so from the second
lookup onward — and an index rebuilt per lookup is by far the worst option,
which is the mistake the operation exists to remove.

## 13. Tradeoffs

- An index costs memory proportional to the collection and pays for itself only
  across repeated lookups. One lookup into a small array should stay a scan.
- `cached` trades correctness-under-mutation for reuse. An array mutated in
  place keeps a stale index; treat cached indexes as valid for immutable data.
- Building through `JIT.index` is not faster than the four lines it replaces.
  The reasons to use it are the schema-checked key, `Date` handling, shared
  caching and AOT — not construction speed.
- The inferred form types its key as `unknown`. Name the key with `.by()` when
  the key type matters at the call site.

## 14. Best practices

- Declare the key on the collection (`.keyed("id")`) and let plans read it, so
  equality, indexing and future lookups agree on one identity.
- Compile the plan once at module scope; it is the plan, not the index, that is
  expensive to create.
- Use `cached` for stable, immutable collections; call the plan directly for
  data you mutate.
- Prefer `grouped()` over building buckets by hand — it is the shape a hash join
  needs, and it appends without `push`.

## 15. Non-goals

- Not a persistent or incremental index. Adding a row does not update a built
  index; rebuild or use a fresh array.
- Not a query engine. Range access, ordering-aware lookup and strategy selection
  belong to the physical query planner, not to this operation.
- Not a uniqueness check. A unique index over duplicate keys keeps the last row
  and reports nothing.
- Not a multi-type key. Every branch of a union key must be the same kind, so a
  `number | string` key is rejected rather than compared across types.
