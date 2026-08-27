# Physical Query Planning

A CQRS query says what is wanted. The physical planner decides how the rows are
reached: a scan, a scan that stops early, a lookup through a cached index, or a
binary search. The declaration does not change — only the collection's facts do.

## 1. Problem

Choosing an access path by hand means writing the choice into the call site:

```ts
// Three call sites, three different decisions, none of them revisitable.
users.find((user) => user.id === id);
usersById.get(id); // and somewhere, the code that built and invalidated it
binarySearchById(users, id); // and the assumption that users is sorted
```

The information needed to choose — is this key unique, is the collection
ordered by it, is it worth keeping an index — is a property of the collection,
not of the call site. Spreading it across call sites is what makes it go stale.

## 2. Why JIT

The collection already declares those facts, and the equality compiler already
reads them. The planner reads the same ones:

| Declaration             | Fact                                           |
| ----------------------- | ---------------------------------------------- |
| `.keyed("id")`          | unique identity **and** an index worth caching |
| `.uniqueBy("id")`       | unique key, no index intent                    |
| `.indexBy("id")`        | equality-access intent, no cached index        |
| `.ordered("id", "asc")` | the collection is sorted by this key           |

Because the facts live on the schema, changing one changes every query over
that collection at once, and `explain()` can say what changed.

## 3. API

There is no API. That is the point.

```ts
const findUser = JIT.cqrs
  .query(Users)
  .params({ id: JIT.number() })
  .where((query, params) => query.eq("id", params.id))
  .first();
```

The same declaration compiles to a scan, an index lookup or a binary search
depending on what `Users` declares. Nothing at the call site names an
algorithm, and there is no `JIT.binarySearch` or `JIT.mapLookup` to choose
between.

## 4. Semantics

The chosen strategy never changes the answer. Every path returns exactly what a
scan would, which the differential test in
`compiler/__tests__/physical-query.test.ts` asserts across present, absent and
boundary keys.

Two strategies rest on declarations the runtime does not verify:

- `BinarySearch` trusts `.ordered(key, direction)`. A collection that is not
  actually sorted by that key returns wrong answers — the same contract the
  equality compiler has always had for `.ordered()`.
- `CachedIndexLookup` trusts that the array is not mutated in place. A cached
  index of a mutated array is stale.

## 5. Selection rules

```text
terminal is first or some
  and the input is an array
  and there is exactly one filter
  and that filter is eq(key, value)
      key is .ordered() and unique      -> BinarySearch      O(log n)
      key is .keyed()                   -> CachedIndexLookup O(1)
      otherwise                         -> EarlyExitScan     O(k)

any other terminal                      -> EarlyExitScan     O(k)
no terminal                             -> Scan              O(n)
```

Ordering wins over indexing where both are declared, because a binary search
allocates nothing.

### Why `findIndex` and `every` stay on a scan

An index maps a key to a row, not to a position, so it cannot answer
`findIndex`. `every` has to see every row by definition. Neither is a gap to
close later; they are simply not questions a key can answer.

### Why `.indexBy()` alone does not build an index

Building an index for a single lookup is strictly worse than scanning:
`pnpm bench:index` measures 456 µs to build against 5.13 µs to scan 10 000
rows. An index only repays across repeated lookups, so the planner takes that
path only where the schema opted into caching it — which is what `.keyed()`
means and `.indexBy()` does not.

## 6. Generated code

`.keyed("id")`:

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
function query(value, params) {
  const row = __cachedIndex(value, "index:unique:id:direct:false", build).get(
    params.id,
  );
  return row;
}
```

`.ordered("id", "asc")`:

```js
function query(value, params) {
  const target = params.id;
  let low = 0;
  let high = value.length - 1;
  while (low <= high) {
    const mid = (low + high) >>> 1;
    const row = value[mid];
    const probe = row.id;
    if (probe === target) {
      return row;
    }
    if (probe < target) low = mid + 1;
    else high = mid - 1;
  }
  return undefined;
}
```

No facts:

```js
function query(value, params) {
  const len = value.length;
  for (let i = 0; i < len; i++) {
    const item = value[i];
    if (item.id === params.id) {
      return item;
    }
  }
  return undefined;
}
```

The keyed paths do not go through the loop IR at all — there is no loop to
shape. The index builder is emitted from the same `IndexDescriptor` that
`JIT.index` uses, and reaches the same per-array cache, so an index built by a
query is the index a `JIT.index` plan finds already built.

## 7. Allocation model

| Strategy            | Allocations per call | Allocations per array    |
| ------------------- | -------------------- | ------------------------ |
| `Scan`              | the result array     | 0                        |
| `EarlyExitScan`     | 0                    | 0                        |
| `BinarySearch`      | 0                    | 0                        |
| `CachedIndexLookup` | 0                    | one `Map` of `n` entries |

`CachedIndexLookup` is the only strategy that keeps memory, and it keeps it in
a `WeakMap` keyed by the array, so it disappears with the data.

## 8. Complexity

```text
EarlyExitScan       O(k), k = position of the answer, O(n) worst case
BinarySearch        O(log n)
CachedIndexLookup   O(n) once, then O(1)
```

## 9. Explain

```ts
const plan = findUser.explain();

plan.physical;
// {
//   strategy: "CachedIndexLookup",
//   reason: "the collection is keyed, so the index is built once per array and reused",
//   complexity: "O(1)",
//   facts: ["keyed: id", "index cache: enabled"],
// }
```

`explain()` reports the decision, the facts it rested on and the expected cost.
It deliberately does not expose the access path's internals — no descriptor, no
query nodes. `explain("generator")` reports no physical plan: the incremental
backends stream and never reach a row by key.

## 10. AOT

The generated module contains the chosen strategy and nothing else — no
planner, no fact resolution, no query interpreter. `__cachedIndex` is emitted
as a module-level helper only when an artifact in that module actually needs
it, and is shared with `JIT.index` plans in the same module.

## 11. The standard stays semantic

`~query` carries the request, never the strategy:

```json
{ "kind": "where", "condition": { "operator": "eq", ... } }
{ "kind": "terminal", "operation": "first" }
```

An adapter reads "the first row whose id equals this parameter" and picks its
own access path. `PhysicalQueryPlan` is private and is asserted absent from the
serialized contract.

## 12. Benchmarks

```text
Command      pnpm bench:cqrs-physical
Source       bench/cqrs-physical/index.ts
Environment  Node 22.22.3, Apple M1, darwin-arm64
Query        where(eq("id", params.id)).first(), target in the middle row
Captured     2026-08-26
```

The same declaration, three access paths. Only the collection's facts differ.

| Rows    | `EarlyExitScan` | idiomatic `find` | `CachedIndexLookup` | `BinarySearch` | prebuilt `Map` |
| ------- | --------------: | ---------------: | ------------------: | -------------: | -------------: |
| 1 000   |        572.4 ns |         410.5 ns |             72.3 ns |        15.8 ns |         5.0 ns |
| 10 000  |         5.16 µs |          4.47 µs |             98.8 ns |        21.1 ns |        11.1 ns |
| 100 000 |        49.22 µs |         40.28 µs |             60.1 ns |        26.9 ns |         3.3 ns |

At 100 000 rows the planner turns a 49 µs scan into a 60 ns lookup — about
670x — without a line of the query changing. The prebuilt `Map` column is
marked not comparable in the harness: it is built outside the measurement and
is the ceiling a cached index aims at, which it lands within a small multiple
of once warm.

### The case where an index loses

An index only pays across repeated lookups against the same array. Rebuild the
array on every call and the cache never hits:

| 10 000 rows, a fresh array each call |    Time |
| ------------------------------------ | ------: |
| `EarlyExitScan`                      | 8.13 µs |
| `BinarySearch`                       | 1.59 µs |
| `CachedIndexLookup`                  |  531 µs |

**`CachedIndexLookup` is 65x slower than a scan here**, because it pays the full
`O(n)` build for a single `O(1)` lookup and then throws it away. This is the
cost of declaring `.keyed()` on a collection that is re-created per call.

`BinarySearch` wins in both regimes — 26.9 ns warm and 1.59 µs cold — because
it allocates nothing. If your arrays are rebuilt per request and are already
sorted, declare `.ordered()` rather than `.keyed()`.

## 13. Tradeoffs

- `.keyed()` is a claim about how the collection is used, not only about its
  shape. Declaring it on a per-request array makes queries slower, measurably.
- `.ordered()` is a claim the runtime cannot check. An unsorted collection
  declared ordered returns wrong answers rather than slow ones.
- The planner only lifts single-equality terminals today. A two-filter query,
  a range predicate or an ordered result stays on a scan.
- Every strategy is chosen at compile time from static facts. There is no
  runtime cost model and no adaptive re-planning.

## 14. Best practices

- Declare `.keyed(key)` for entity collections you hold and query repeatedly.
- Declare `.ordered(key, direction)` when the data is already sorted — it is
  the only strategy that is never worse than a scan.
- Use `.uniqueBy()` or `.indexBy()` when you want the fact recorded without
  opting into a cached index.
- Read `explain().physical` when a query is slower than expected; it names the
  strategy and the facts it used.
- Keep queried arrays stable. Reuse is what an index is paid for.

## 15. Non-goals

- No runtime statistics, cardinality estimation or adaptive re-planning.
- No range scan or top-K yet. Join planning now selects hash, indexed or merge
  strategies and is documented separately in [joins](./joins.md).
- Distinct planning selects scalar lookup, compound trie, structural
  hash/equality confirmation or ordered adjacent comparison. These strategy
  names remain outside the portable query protocol.
- No verification of declared facts. `.ordered()` and `.keyed()` are trusted,
  in exchange for the code the planner does not have to emit.
- No physical plan in `~query`. External adapters get the request and choose
  their own path.
