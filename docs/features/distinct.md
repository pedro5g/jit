# Distinct query rows

## 1. Problem

Deduplicating object rows with `JSON.stringify`, composite string keys, or repeated linear equality checks allocates a temporary key per row or degrades toward O(n²). `unique(key)` already preserves compatibility for one property; `distinct` defines full-value and compound-key semantics without adding a second query engine.

## 2. Why JIT

The schema identifies scalar representations, structural equality and structural hashing. Collection ordering facts can eliminate the lookup structure entirely. The compiler chooses an access path and emits direct field reads into the existing fused query loop.

## 3. API

```ts
const uniqueRows = JIT.cqrs.query(User).distinct();
const uniqueTenants = JIT.cqrs.query(User).distinct("tenantId");
const uniquePerTenant = JIT.cqrs.query(User).distinct("tenantId", "id");
```

`unique(key)` remains a compatibility operation for first-row-per-key behavior. New code that means semantic deduplication should use `distinct`.

## 4. Semantics

`distinct()` keeps the first row for each value under the compiled equality of the complete row schema. `distinct(fields...)` keeps the first row for each selected key. Output order is stable. Projected fields must currently be scalar schema fields; full structural rows may contain nested structures. Repeated or unknown fields are rejected.

`NaN` follows SameValueZero key semantics. Date keys compare numeric time values, not object identity.

## 5. Compilation

`QueryDistinctNode` is part of `QueryProgram`; it is not a separate engine. `DistinctDescriptor` resolves the physical strategy from fields, scalar representations and collection ordering. The accept check is hoisted and called from the same guarded loop as filters and projection.

## 6. Generated code

For a scalar key the emitted check is equivalent to:

```js
const key = item.id;
if (seen.has(key)) continue;
seen.set(key, true);
```

For a complete row, the generated hash chooses a collision bucket and compiled equality confirms matches. There is no schema walker, `JSON.stringify`, generic path loop, `.filter()` or per-row closure.

## 7. Allocation model

- Scalar: one retained key table and the output array.
- Ordered scalar: one two-slot state object and the output array; no key-table entries.
- Compound scalar: one nested `Map` trie; no tuple, array or string key per row.
- Structural: one hash map and one bucket array per occupied hash; equality runs only inside a collision bucket.
- Iterator and visitor use the same retained state without an intermediate result array.

## 8. Complexity

Scalar, compound and structural-hash strategies are expected O(n), subject to ordinary hash-map behavior and structural hash cost. Ordered adjacent distinct is O(n) time and O(1) retained deduplication state. Repeated linear structural comparison is O(n²).

## 9. Physical strategies

| Facts and request               | Strategy                                   |
| ------------------------------- | ------------------------------------------ |
| one scalar field                | scalar key table                           |
| matching `.ordered(field)` fact | adjacent comparison                        |
| several scalar fields           | nested `Map` trie                          |
| complete object                 | structural hash plus equality confirmation |

The ordering strategy is selected only from a declared collection fact. The caller never names an algorithm.

## 10. AOT

Runtime and define use the same declaration. AOT emits the accept check, schema-specialized hash and schema-specialized equality as standalone JavaScript/TypeScript. It does not import JIT, a query interpreter, schema walker or distinct registry.

## 11. Runtime/AOT parity

Runtime, eager AOT, iterator, async iterator and visitor preserve first-row stability and equality semantics. `~query` remains version 1 and carries `{ kind: "distinct", fields }`; it never exposes a physical strategy name.

## 12. Benchmarks

Environment: Node 22.17.1, Linux x64, AMD Ryzen 7 5800H, 100,000 rows, benchmark-runner warmup and adaptive iterations. Reproduce with `pnpm bench:distinct`. Heap figures are observed deltas and vary with GC timing.

Times are per-iteration medians; heap is the observed average delta per iteration.

| Scenario                        | Idiomatic JS | Handwritten | JIT runtime | JIT AOT | JIT heap/iter |
| ------------------------------- | -----------: | ----------: | ----------: | ------: | ------------: |
| scalar, 50% duplicate           |     14.18 ms |     4.98 ms |     5.69 ms | 5.55 ms |       4.18 MB |
| ordered adjacent, 50% duplicate |      4.21 ms |     0.60 ms |     1.03 ms | 1.01 ms |       0.76 MB |
| compound key                    |     16.21 ms |     5.17 ms |     5.74 ms | 5.62 ms |       4.70 MB |
| complete structural row         |     46.12 ms |    35.43 ms |     8.76 ms | 8.58 ms |       6.87 MB |

Runtime and AOT stay within a few percent of each other on every strategy, which is the parity the contract requires. The scalar, adjacent and compound paths approach the handwritten ceiling while avoiding the idiomatic intermediates; on the adjacent path the remaining gap is the accept-function call the handwritten loop inlines by hand.

Structural distinct is the one case that beats its ceiling: the handwritten row builds a `JSON.stringify` key per row, while the compiled path hashes the three declared fields directly and confirms with compiled equality, so it reads about 4× faster at the cost of retaining collision buckets. That is a property of this dataset and this ceiling, not a universal speedup claim.

## 13. Tradeoffs

For very small arrays, a short handwritten scan can cost less than allocating a hash table. Structural hashing reads the schema fields and retains collision buckets. An ordering fact is a contract: falsely declaring unsorted data as ordered can invalidate operations that rely on it.

## 14. Best practices

Use one projected scalar field when that is the real identity. Declare `.ordered()` only when input preserves it. Use `distinct()` when equality of the whole row is intended, and prefer iterator or visitor sinks when the consumer does not need an array.

## 15. Non-goals

This milestone does not deduplicate arbitrary non-scalar projected fields, expose physical algorithm selectors, stringify composite keys, sort unordered input merely to deduplicate it, or introduce `~query` V2.
