# Joins

`JIT.cqrs.query(left).join(right).on(leftKey, rightKey)` compiles a semantic
join to one physical access build and one left-side scan. Callers choose the
relation (`inner`, `left`, `semi`, or `anti`); collection facts choose the
algorithm.

## 1. Problem

The direct JavaScript expression for relating two arrays is usually a nested
`find` or `filter`. It reads the right collection again for every left row,
which is `O(n*m)`, and callback/temporary-array costs sit inside the hot path.

## 2. Why JIT

Both schemas fix the join keys and their scalar representations. JIT can reject
keys that can never compare equal, normalize `Date` keys consistently, build or
reuse the right access path once, and emit direct property reads without a
generic matcher.

## 3. API

```ts
const joinOrders = JIT.cqrs
  .query(Order)
  .join(JIT.array(Customer).keyed("id"))
  .on("customerId", "id");

const pairs = joinOrders(orders, customers);
// Array<{ left: Order; right: Customer }>
```

The second argument to `join` is the semantic kind:

```ts
query.join(Customer, "inner").on("customerId", "id"); // default
query.join(Customer, "left").on("customerId", "id");
query.join(Customer, "semi").on("customerId", "id");
query.join(Customer, "anti").on("customerId", "id");
```

`inner` and `left` return stable `{ left, right }` pairs. `semi` and `anti`
return left rows directly, so they do not allocate pair objects.

## 4. Semantics

- `inner` emits one pair for every matching right row. Duplicate right keys
  preserve multiplicity and right-side order.
- `left` additionally emits one `{ left, right: undefined }` pair when no right
  row matches.
- `semi` emits a left row once when at least one right row matches.
- `anti` emits a left row once when no right row matches.
- Left input order is stable. Hashing does not reorder the result.
- Keys must exist and share an exact scalar equality domain. A number key is
  rejected against a string key even though both are legal `Map` keys.
- `params` and `where` before `join` are fused into the left scan. V1 rejects
  pre-join projection, ordering, collection sinks, terminals and mutation
  rather than materializing an ambiguous intermediate result.

## 5. Compilation

`QueryJoinKind` is semantic data. `JoinPlan` resolves the schemas, keys and
existing left query program, then selects one of three private strategies:

- `IndexedJoin`: the right collection declares `.keyed(rightKey)`, so the
  shared per-array `WeakMap` cache supplies the index;
- `HashJoin`: the invocation builds a right-side `Map` once;
- `MergeJoin`: both inputs declare compatible ordering on their join keys, so
  two cursors replace the `Map` entirely.

Unique right facts store one row per key. Non-unique `inner` and `left` joins
store compact row buckets; `semi` and `anti` only need key presence and never
allocate buckets.

## 6. Generated code

For a keyed right side the high-level plan disappears:

```js
function join(left, right) {
  const index = __cachedIndex(right, "index:unique:id:direct:false", build);
  const len = left.length;
  const out = new Array(len);
  let k = 0;
  for (let i = 0; i < len; i++) {
    const leftRow = left[i];
    const match = index.get(leftRow.customerId);
    if (match !== undefined) out[k++] = { left: leftRow, right: match };
  }
  out.length = k;
  return out;
}
```

There is no nested `.find`, callback, schema walker, join planner or algorithm
registry in the emitted module.

## 7. Allocation model

| Strategy        | Access allocation                              | Result allocation                 |
| --------------- | ---------------------------------------------- | --------------------------------- |
| unique hash     | one `Map` per call                             | one array plus one pair per match |
| non-unique hash | one `Map` plus one bucket per key              | one array plus one pair per match |
| indexed         | cached `Map` only on the first right-array use | one array plus one pair per match |
| merge           | no access-path allocation                      | one array plus one pair per match |
| semi / anti     | one `Map` or cached index, no buckets          | one array, no pair objects        |

The cache is keyed weakly by the right array reference. Mutating that array in
place after caching makes its declared facts stale; replace the array when its
contents change.

## 8. Complexity

For `n` left rows, `m` right rows and `k` emitted pairs:

```text
nested find/filter:       O(n*m + k)
HashJoin:                 expected O(n + m + k)
IndexedJoin after build:  expected O(n + k)
MergeJoin:                O(n + m + k)
```

The first indexed call still pays the `O(m)` build. The win comes from reuse.

## 9. Physical strategies

`join.explain()` reports `HashJoin`, `IndexedJoin` or `MergeJoin`, the keys,
semantic kind, facts used and expected complexity. These private names never enter `~query`;
the standard carries only what relation was requested.

## 10. AOT

The same declaration works through `@jit-compiler/jit/define`. Generated JS/TS
contains the selected loop and only the cache helper when the selected strategy
needs it. Bindings used by a left filter must be reconstructible or generation
reports an explicit skip.

## 11. Runtime/AOT parity

The global parity matrix executes the same join inputs through runtime and AOT,
and verifies that the define artifact cannot execute before generation. Focused
tests cover source quality, key types, duplicates, absent keys and all four
join kinds. A bundler fixture proves a join does not retain unrelated CQRS,
serialization or structural-operation families.

## 12. Benchmarks

```text
Command      pnpm bench:join
Source       bench/join/index.ts
Environment  Node 22.17.1, AMD Ryzen 7 5800H, linux-x64
Dataset      unique numeric right key, 50% matches, warmed harness
Captured     2026-08-26
```

| Scenario             | Nested `find` |                 Handwritten hash | JIT runtime |   JIT AOT | Runtime heap |
| -------------------- | ------------: | -------------------------------: | ----------: | --------: | -----------: |
| 1k left / 1k right   |     678.39 µs |                         34.90 µs |    36.03 µs |  34.70 µs |     107.8 kB |
| 10k left / 10k right |      63.25 ms |                        961.04 µs |   952.37 µs | 954.37 µs |      1.39 MB |
| 10k left / 1k right  |       9.61 ms |                        120.51 µs |   120.30 µs | 119.68 µs |     335.7 kB |
| cached 10k / 10k     |             — |                964.96 µs rebuild |   181.65 µs | 186.98 µs |     503.0 kB |
| ordered 10k / 10k    |             — | 976.93 µs hash / 105.13 µs merge |   113.48 µs | 113.10 µs |     503.1 kB |

The hash plan is level with the handwritten ceiling in these runs. The
algorithmic comparison is the nested reference: 63.25 ms becomes 0.95 ms at
10k/10k. Reusing a keyed index makes the repeated query 5.3x faster than
rebuilding the handwritten `Map`. AOT variation at 10k/10k was above runtime
in this capture, so no claim is made that AOT is intrinsically faster; its
benefit here is import-free startup and exact physical lowering.

Compatible ordering selects `MergeJoin`: 113.48 µs runtime and 113.10 µs AOT,
within 8% of the 105.13 µs handwritten merge ceiling. That is 8.6x faster and
uses about 2.8x less heap than rebuilding the handwritten hash index. This is
the measured gate that justifies keeping the third physical strategy.

## 13. Tradeoffs

- A one-off small join still pays a `Map` build and may not repay compilation.
- Non-unique joins allocate right buckets and may emit more than `n` pairs.
- Cached indexes assume immutable-by-reference collections.
- Pair objects are part of `inner`/`left` observable output; JIT cannot remove
  them until a later projection can be fused into the join.

## 14. Best practices

- Declare `.keyed(key)` only when the same right array is reused and not
  mutated in place.
- Use `semi`/`anti` when only membership matters; they avoid pair allocation.
- Put left predicates in `where` before `join` so rejected rows never probe the
  index.
- Inspect `explain()` when a repeated join unexpectedly selects `HashJoin`.

## 15. Non-goals

- No right/full join in V1.
- No caller-selected hash/index algorithm.
- No database adapter or exposure of `JoinPlan` through the standard.
- No caller-forced merge join. It is selected only when both ordered facts are
  compatible with the declared keys and direction.
- No post-join projection in this milestone. It belongs to the shared
  `ProjectionTree` work, where pair allocation can actually be removed.
