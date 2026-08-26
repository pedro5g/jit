# CQRS Queries

## 1. Problem

Read models need typed filtering, projection, ordering, grouping, incremental delivery and reduction without callback chains and intermediate arrays. A separate CQRS engine would duplicate semantics and codegen.

## 2. Why JIT

The schema fixes the row shape and legal keys before compilation. JIT can emit direct property access, fuse compatible nodes, select an incremental backend and reject invalid fields early.

## 3. API

```ts
const User = JIT.object({ id: JIT.number(), active: JIT.boolean() });
const activeIds = JIT.cqrs
  .query(User)
  .where((query) => query.eq("active", true))
  .select("id")
  .limit(100);
```

The surface also carries uniqueness, collectors, ordering, incremental control, mutation, scalar aggregates, iterator, async iterator and visitor backends. `filter` and `take` remain compatibility aliases for `where` and `limit`. Top-level `JIT.query(arraySchema)` remains a compatibility path and receives no exclusive features.

## 4. Semantics

Nodes retain user order. Parameter declarations accumulate and duplicate names are rejected. `~query.version` remains `1`.

## 5. Compilation

CQRS adapts the existing `QueryProgram`, eager query IR, optimizer and lazy emitters. It does not create a second internal AST. The portable `~query.definition.pipeline` is separately allocated semantic data and never exposes private or physical plans.

## 6. Generated code

Eager queries lower to specialized loops. Incremental backends are emitted only when selected. AOT contains no CQRS builder or query interpreter.

## 7. Allocation model

Fusible filters and projections write into the final output. Iterator and visitor backends avoid the result array. Collectors, sorting and stateful operations remain explicit barriers.

## 8. Complexity

Current scans are `O(n)` before sorting or keyed collectors. Sorting is `O(n log n)`; hash-backed uniqueness/grouping is expected `O(n)`. Physical index selection is a later milestone and is not claimed here.

## 9. Physical strategies

The engine selects eager-array, generator, async-generator or visitor output and reports materialization barriers through `explain()`.

## 10. AOT

Runtime and define expose the same chain. Define queries are typed non-executable stubs. Every terminal registers its selected backend and generates standalone output with no JIT import.

## 11. Runtime/AOT parity

The parity matrix compares runtime and generated results and verifies metadata and define-stub behavior. Query AOT tests cover parameters, incremental programs and deterministic source.

## 12. Benchmarks

Measured on 2026-08-26 with Node 22.22.3, Apple M1, after harness
warm-up, using `pnpm bench:cqrs`:

| Scenario                                     |  JIT runtime |                                              Handwritten | Reported allocation |
| -------------------------------------------- | -----------: | -------------------------------------------------------: | ------------------: |
| bounded input normalization                  | 174.50 ns/op | 114.88 ns/op (not comparable: assumes valid exact input) | 42.76 B vs 601.10 B |
| two filters + projection + limit, 1,000 rows | 434.03 ns/op |                                             424.13 ns/op |  3.54 KB vs 3.14 KB |

The consolidation is effectively level with the handwritten scan in this
fixture and does not claim a new speedup. It changes API ownership, typing and
AOT parity without changing the emitter. Use `pnpm bench:query` and
`pnpm bench:lazy` for individual backends. Physical-planner milestones must add
idiomatic, handwritten, runtime-JIT and AOT variants before publishing access
path speedups.

## 13. Tradeoffs

Very small one-off arrays may not repay compile cost. Iterator protocol overhead can exceed a direct visitor when every row is consumed.

## 14. Best practices

Compile once, use declared params, select only required fields, prefer visitors for push-based hot paths and inspect barriers before optimizing.

## 15. Non-goals

CQRS does not provide a database adapter, expose private IR, silently fetch data for unsupported external operations or require callers to select an algorithm.
