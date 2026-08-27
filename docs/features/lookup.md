# Lookup

## 1. Problem

Reaching one row by key is the most common thing anyone does to a collection, and the idiomatic spelling — `rows.find((row) => row.id === id)` — is a full linear scan with a closure allocated per call. The alternatives all make the caller choose an algorithm: build a `Map` and remember to rebuild it, or hand-roll a binary search and remember which half to continue into. That choice is not the caller's to make well: it depends on facts about the collection that the schema already records.

## 2. Why JIT

The collection already declares what identity means and how it is arranged: `.keyed("id")`, `.uniqueBy("id")`, `.ordered("createdAt", "asc")`. Those facts are exactly the inputs an access-path decision needs. A compiler that reads them can emit a cached index lookup, a binary search or an early-exit scan from the same declaration, and can be sure the choice matches the data — because the data described itself.

## 3. API

```ts
const userById = JIT.lookup(Users);
const user = userById(users, 42);
```

The key is inferred from the collection's facts. Name one when there is no fact, or to override:

```ts
const userByEmail = JIT.lookup(Users).by("email");
```

`explain()` reports the access path that was chosen:

```ts
userById.explain();
// { strategy: "CachedIndexLookup", reason: "…", complexity: "O(1)", facts: ["keyed: id", "index cache: enabled"] }
```

## 4. Semantics

A lookup answers the first row whose key equals the argument, or `undefined`. Keys are matched with `===`, so a `Date` key is compared by timestamp on both sides — the value passed in stays a `Date`. A collection with no key fact and no `.by()` throws at declaration rather than scanning something arbitrary. Declaring `.ordered()` is a contract: a binary search over data that is not actually ordered will miss rows.

## 5. Compilation

```
JIT.lookup(Users)
        ↓
LookupDescriptor  ← key from .keyed/.indexBy/.uniqueBy, or .by()
        ↓
resolveKeyedAccessChoice(schema, key)   ← the collection's facts
        ↓
CachedIndexLookup | BinarySearch | EarlyExitScan
        ↓
specialized JavaScript
```

`resolveKeyedAccessChoice` is the same function the CQRS planner calls for `where(eq).first()`, and the index and binary-search bodies are the same emitters. A standalone lookup and a keyed query terminal are one question asked twice, so they cannot disagree about the facts or the generated code.

## 6. Generated code

Keyed — reaches the shared per-array index, built once and reused:

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
function query(value, key) {
  const row = __cachedIndex(value, "index:unique:id:direct:false", build).get(key);
  return row;
}
```

Ordered and unique — no allocation at all:

```js
function query(value, key) {
  const target = key;
  let low = 0;
  let high = value.length - 1;
  while (low <= high) {
    const mid = (low + high) >>> 1;
    const row = value[mid];
    const probe = row.id;
    if (probe === target) return row;
    if (probe < target) low = mid + 1;
    else high = mid - 1;
  }
  return undefined;
}
```

No fact — an indexed loop that returns the moment it matches:

```js
function lookup(value, key) {
  const target = key;
  for (let i = 0, len = value.length; i < len; i++) {
    const row = value[i];
    if (row.name === target) return row;
  }
  return undefined;
}
```

## 7. Allocation model

The scan and binary paths allocate nothing per call: no closure, no key string, no result wrapper. The keyed path allocates one `Map` the first time it sees an array and reuses it for every later call on that same array; the cache is keyed by array identity and by the index's own shape, so two operations wanting the same index share one.

## 8. Complexity

```
idiomatic .find():   O(n) per lookup, one closure per call
EarlyExitScan:       O(k), k = position of the match
BinarySearch:        O(log n), no allocation
CachedIndexLookup:   O(n) once per array, then O(1) per lookup
```

## 9. Physical strategies

| Declared facts                     | Strategy            | Complexity |
| ---------------------------------- | ------------------- | ---------- |
| `.ordered(key)` and unique         | `BinarySearch`      | O(log n)   |
| `.keyed(key)` / entity cache index | `CachedIndexLookup` | O(1)       |
| nothing that reaches the key       | `EarlyExitScan`     | O(k)       |

An ordered key wins over an index even where both are declared: searching allocates nothing, and building an index for a single lookup costs more than the lookup saves.

## 10. AOT

The declaration is identical, and the generated module is standalone: no import of JIT, no planner, no descriptor, no strategy name. Only the keyed path carries anything at all — the shared `__cachedIndex` helper — because that is the only path that needs one. The binary and scan paths lower to the loop and nothing else.

## 11. Runtime/AOT parity

`JIT.lookup` exists on `@jit-compiler/jit/runtime` and `@jit-compiler/jit/define` with the same signature, is registered as a reconstructive `lookup-plan` artifact, and is covered by the runtime/define/AOT parity matrix. The generated declaration types the key from the row's own field, so `userByEmail` takes a `string` and `userById` a `number`.

## 12. Benchmarks

Environment: Node 22.17.1, Linux x64, AMD Ryzen 7 5800H, 100,000 rows, 64 probes spread across the array per iteration, benchmark-runner warmup and adaptive iterations. Reproduce with `pnpm bench:lookup`. Times are per-iteration medians for the whole 64-probe sweep.

| Scenario                | Idiomatic `.find()` | Handwritten | JIT runtime | JIT AOT |
| ----------------------- | ------------------: | ----------: | ----------: | ------: |
| scan, no key fact       |            19.80 ms |     2.79 ms |     2.75 ms | 2.80 ms |
| binary, ordered unique  |            20.12 ms |     1.78 µs |     1.85 µs | 1.83 µs |
| cached index, keyed     |            19.79 ms |    334 ns\* |     1.21 µs | 1.43 µs |

\* The handwritten `Map` is built once outside the measurement, so it is a floor rather than a ceiling; the JIT figure includes reaching through the shared cache. The runner marks it `[not comparable]`.

Two things are worth reading off this table. On the scan and binary paths the compiled lookup sits at the handwritten ceiling — within measurement noise — which is the target the plan sets, not a speedup claim. Against the idiomatic spelling the difference is not a constant factor but a change of complexity: 20 ms against 1.8 µs on the ordered path is what O(n) versus O(log n) looks like at 100,000 rows, and it comes from a declaration the schema already carried.

Heap per iteration is 0.0–0.8 KB for every JIT path and 6–7 KB for `.find()`, which is the per-call closure.

## 13. Tradeoffs

For a handful of rows a scan is the right answer and the index would be waste; that is why the index path is taken only where the schema opted into caching it. The cached index is held against the array by identity, so an array that is rebuilt on every render gets no reuse — key the collection or reuse the array. A `.ordered()` fact that the data does not honour produces wrong answers rather than slow ones.

## 14. Best practices

Declare the facts that are true — `.keyed("id")` for an entity collection you look into repeatedly, `.ordered()` only when the input really is sorted — and let the planner choose. Read `explain()` when a lookup is slower than expected: it names the strategy and the facts it rested on, which is usually enough to see which declaration is missing.

## 15. Non-goals

A lookup answers one row by one key. It does not do compound keys, ranges, partial matches or multi-row results — those are queries, and `JIT.cqrs.query()` covers them with the same access paths underneath. It does not expose a strategy selector, does not sort input to make a binary search possible, and does not build an index the schema did not ask for.
