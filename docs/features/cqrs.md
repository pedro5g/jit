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

### Terminal sinks

Four terminals answer from inside the loop instead of collecting a result:

```ts
const Users = JIT.array(JIT.object({ id: JIT.number(), active: JIT.boolean() }));
const query = JIT.cqrs.query(Users).where((q) => q.eq("active", true));

query.first(); // the first matching row, or undefined
query.findIndex(); // its index in the input, or -1
query.some(); // true as soon as one row matches
query.every(); // true when every row matches; stops at the first that does not
```

The filters are the predicate; the terminal decides how the pass ends. `some`
and `every` are opposites over the same condition — `every` exits on the first
row the filters reject.

There is deliberately no `find` and no `firstOrUndefined`. Both would name the
same operation as `first`: the predicate already lives in `where`, and `first`
already returns `undefined` when nothing matches. A throwing variant is not
provided either — it would not let the compiler avoid any work.

## 4. Semantics

Nodes retain user order. Parameter declarations accumulate and duplicate names are rejected. `~query.version` remains `1`, and now carries a `terminal` pipeline step so an external adapter can read "first matching row" or "does any row match" rather than inferring it from a limit.

A terminal must be able to answer from one pass, so it is rejected alongside
`unique`, `keyed`, `groupBy`, `orderBy`, aggregates and mutations — each of those
has to see the whole result before it can answer, which is exactly what the
early exit exists to avoid. `select` is accepted before `first` (the single row
is projected) and rejected before the scalar terminals, where no row is built.
A terminal also cannot feed `to.iterator()`, `to.visitor()` or `lazy()`: there is
no stream left to yield.

## 5. Compilation

CQRS adapts the existing `QueryProgram`, eager query IR, optimizer and lazy emitters. It does not create a second internal AST. The portable `~query.definition.pipeline` is separately allocated semantic data and never exposes private or physical plans.

## 6. Generated code

Eager queries lower to specialized loops. Incremental backends are emitted only when selected. AOT contains no CQRS builder or query interpreter.

## 7. Allocation model

Fusible filters and projections write into the final output. Iterator and visitor backends avoid the result array. Collectors, sorting and stateful operations remain explicit barriers.

Terminals allocate nothing at all beyond the answer: no result array, no cursor,
no per-row object. `first` with a `select` allocates the one projected row;
`some`, `every` and `findIndex` allocate zero, which `explain()` reports as
`estimatedAllocationsPerResult: 0`.

## 8. Complexity

Terminals are `O(n)` worst case and `O(k)` in practice, where `k` is the
position of the answer: the loop returns as soon as it is known. Choosing an
access path from collection facts — turning `where(eq(key)).first()` into an
index lookup or a binary search — is the physical-planner milestone and is not
claimed here.

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

### Terminal sinks

Measured with `pnpm bench:cqrs-terminal` on the same machine, 10 000 rows,
`where(eq("id", target)).first()`:

| Match position | Idiomatic `find` | Handwritten loop | JIT `first()` | JIT filter then `[0]` |
| -------------- | ---------------: | ---------------: | ------------: | --------------------: |
| middle row     |         7.11 µs |         5.07 µs |      5.10 µs |              16.44 µs |
| last row       |        14.22 µs |        10.15 µs |     10.29 µs |              14.83 µs |
| no match       |        14.18 µs |        10.12 µs |     10.18 µs |              14.55 µs |
| `every`, all match | 11.96 µs |                — |     10.26 µs |                     — |

`first()` is level with a handwritten loop and ~1.4x ahead of `Array.prototype.find`,
which pays a callback per row. The larger number is the column on the right:
collecting every match and taking the first costs 14–16 µs regardless of where
the answer is, so `first()` is 1.4x better at the worst case and far better
whenever the match is early. `some()` against `count() > 0` is the same story —
82 ns versus 10.25 µs when the match is near the front.

Scenarios where the match sits at row 0 fall below this harness's useful
resolution (every implementation returns immediately and what is left is call
dispatch). Measured directly in a 2 000 000-iteration loop instead, an immediate
match is 3.20 ns for `first()` against 6.56 ns for `find` — the difference being
the callback the compiled loop does not make.

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

Terminals do not pick an access path yet: `where(eq("id", x)).first()` is an
early-exit scan even when the collection declares `.keyed("id")`. That selection
is the physical planner's job.

CQRS does not provide a database adapter, expose private IR, silently fetch data for unsupported external operations or require callers to select an algorithm.
