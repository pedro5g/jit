# Evolution plan completion audit — 2026-08-27

## Scope and verdict

This audit checks the specialized-data-operations plan from M0 through M26 against the implementation, public surfaces, tests, generated source, AOT output, documentation and reproducible benchmarks.

Verdict: every accepted milestone is implemented and covered. M20 (`memo`) and the extra M26 `JIT.merge` spelling remain deliberately rejected by the plan's own performance gate; their lower-level primitives are present and measured. No accepted feature is runtime-only.

## Milestone checklist

| Milestone | Result | Principal evidence |
| --- | --- | --- |
| M0 operation/IR audit | ✅ | `docs/internal/STATUS.md`, architecture and feature inventory |
| M1 runtime/define/AOT parity | ✅ | `entrypoints.test.ts`, `aot.test.ts`, `treeshake.test.ts`, `docs/aot/api-parity.md` |
| M2 canonical `JIT.cqrs` | ✅ | `cqrs.test.ts`, structural `~query` V1 coverage, compatibility `JIT.query` |
| M3 OrderingDescriptor/SortPlan | ✅ | `sort.test.ts`, generated-source snapshot, AOT/tree-shaking, `bench/sort` |
| M4 IndexDescriptor/IndexPlan | ✅ | `indexing.test.ts`, cached/compound/grouped tests, AOT/tree-shaking, `bench/index` |
| M5 physical planner V1 | ✅ | differential scan/index/binary tests in `physical-query.test.ts`; explain and cold-index measurements |
| M6 terminal sinks | ✅ | early-exit/source assertions in `cqrs-terminals.test.ts`; runtime/AOT benchmark |
| M7 composite aggregate | ✅ | single-loop/source assertions in `cqrs-aggregate.test.ts`; runtime/AOT/ceiling benchmark |
| M8 grouped aggregate | ✅ | no-group-array and average-finalization tests; allocation benchmark |
| M9 JoinPlan V1 | ✅ | inner/left/semi/anti and boundary tests in `cqrs-join.test.ts` |
| M10 MergeJoin | ✅ | ordered-fact selection plus differential behavior in `cqrs-join.test.ts` |
| M11 distinct consolidation | ✅ | scalar/compound/adjacent/structural strategies in `cqrs-distinct.test.ts` |
| M12 LookupPlan | ✅ | present/absent/boundary differential cases in `lookup.test.ts` |
| M13 ReconcilePlan | ✅ | channel selection, diff, iterator, visitor, duplicate keys and O(n+m) source checks in `reconcile.test.ts` |
| M14 ProjectionTree | ✅ | projection/query/compare/cache/access reuse in `projection.test.ts` and consumer tests |
| M15 selective compare | ✅ | type/runtime/source coverage in `projection.test.ts`; runtime/AOT benchmark |
| M16 ChangedPlan | ✅ | number/bigint masks, path lookup and AOT in `changed.test.ts` |
| M17 RFC 6902/7396 patch | ✅ | operation/path/error/immutability tests in `patch.test.ts`; both tree-shaking fixtures |
| M18 CanonicalPlan | ✅ | deterministic order and representation tests in `canonical.test.ts` |
| M19 CacheKeyPlan | ✅ | field specialization, structural boundaries and AOT in `cache-key.test.ts`; benchmark includes AOT |
| M20 memo | ⛔ rejected by gate | measured 33–77% regression for cheap/moderate work in `docs/features/cache-key.md`; caller-owned `Map` recipe retained |
| M21 Access Control Plan | ✅ | allow/deny precedence, field rules, actors and AOT in `access.test.ts` |
| M22 MatchPlan | ✅ | exhaustive/partial narrowing, unknown-tag guard, callback reconstruction/closure skip and tree-shaking |
| M23 MigrationPlan | ✅ | version dispatch, zero-copy current version, mapper edges, types, runtime/define/AOT and benchmark |
| M24 CSV | ✅ | RFC 4180, fragmented UTF-8, CRLF, aliases, types, runtime/define/AOT, sinks and benchmark |
| M25 NDJSON | ✅ | physical line errors, fragmented chunks, fused filter/select/stringify, sinks, runtime/define/AOT and benchmark |
| M26 merge audit | ⛔ duplicate API rejected | specialized compiler exists; public contract is RFC 7396 `JIT.patch.merge`; another spelling avoids no work |

## Public API and type audit

- Runtime and define use the same names and register reconstructive metadata. Generated JS and typed TS are covered centrally.
- `JIT.enum(["admin", "user"])` infers `"admin" | "user"` without a tuple assertion. A compile-time regression test protects this exact call.
- New APIs use `const` generics, discriminated unions and precise mapped/conditional types. No new `any` was introduced outside existing compatibility boundaries.
- All `packages/jit/src/**/index.ts` files are barrels only. An AST-based architecture test rejects executable declarations or statements in an index.
- `~query` remains structural V1 and contains semantic requests only; private physical nodes and access-path internals do not cross it.

## Generated-code and hot-path audit

The emitted-source snapshots and direct source assertions verify the following properties:

- known fields use static property access; schema-known object construction uses stable literals in fixed property order;
- numeric terminal ordering uses subtraction only where it cannot hide tie-breaking or nullish/NaN semantics;
- eager loops cache `length`, use indexed `for`, and return early for terminals;
- sized outputs are preallocated where cardinality is known; joins trim their preallocated output and projections use fixed literals;
- composite aggregation emits one row loop and one accumulator local per reduction; grouped aggregation stores accumulators, never arrays of group rows;
- cached index and binary-search strategies replace scans only from collection facts; differential tests prove answer equivalence;
- keyed reconcile is O(n+m), using one map and one pass per side; requested channels alone are emitted;
- CSV/NDJSON eager, visitor and fused sinks scan directly into their selected sink. There is no generator intermediary, collection query, generic `map/filter/reduce`, schema walker or per-row closure;
- NDJSON advances through its buffer with a cursor and compacts once per chunk, avoiding repeated prefix slicing; UTF-8 decoder flush order is preserved when text and byte chunks are mixed;
- nested loops remain only where output multiplicity requires them, such as duplicate-key join runs. They are not accidental scan-within-scan algorithms.

Dynamic `Object.keys` remains only at genuinely dynamic boundaries such as catch-all records, descriptor-safe static-data serialization and structural schemas. It is absent from known-shape hot paths.

## Organization audit

Line count alone was not treated as a design defect: `binary-rowset.ts` owns one physical storage compiler, while the larger factory files own one typed fluent surface each. Mixed responsibilities were treated as defects. In particular, callback source reconstruction and generated TypeScript signature derivation were removed from the AOT artifact emitter into `aot/serialize-callback.ts` and `aot/artifact-types.ts`, with focused tests for closure rejection and method normalization. New migration, CSV and NDJSON implementations are split into descriptor/factory/compiler modules rather than extending a central namespace file.

The source indexes contain no behavior, namespace barrels do not become dependency-cycle hubs, local ESM imports use emitted `.js` extensions, and type-only dependencies use `import type`.

## Coverage matrix

Every accepted public feature has all applicable layers:

| Layer | Evidence |
| --- | --- |
| runtime semantics | colocated factory/compiler Vitest suites |
| type inference and invalid calls | `expectTypeOf` and `@ts-expect-error` cases in feature suites |
| define parity | central runtime/define matrix in `entrypoints.test.ts` |
| AOT semantic parity | generated modules executed in `aot.test.ts` |
| deterministic source | `generated-source-snapshots.test.ts` |
| tree shaking | focused esbuild fixtures in `treeshake.test.ts` |
| physical equivalence | differential scan/access-path tests for index, lookup, joins and physical CQRS |
| docs examples | site `audit:docs` executes every example against the real library |
| measured claims | feature-specific `bench/*` suites include idiomatic, handwritten ceiling, runtime JIT and standalone AOT |

## Performance measurements

Measurements were reproduced on Node 22.22.3, Apple M1, darwin-arm64. Full methodology and tradeoffs live in each feature document.

- physical lookup, 100,000 rows: scan 51.40 µs runtime, cached lookup 64.7 ns runtime / 62.4 ns AOT, binary search 26.7 ns runtime / 23.4 ns AOT;
- cold 10,000-row index: 549.7 µs runtime versus a 10.79 µs scan, explicitly documenting the losing regime;
- five reductions: 25.79 µs runtime / 26.15 µs AOT, 69.00 µs as five scalar passes and 27.22 µs handwritten;
- grouped aggregate: 102.23 µs runtime / 101.27 µs AOT versus 221.63 µs group-then-reduce;
- cache key hash: 194.93 µs runtime / 193.68 µs AOT and 83.7 KB sampled heap;
- CSV parse: 2.43 ms runtime / 2.57 ms AOT, with full RFC/validation work;
- fused NDJSON pipeline: 3.53 ms runtime / 3.52 ms AOT and 1.98 MB, versus 3.73 ms / 2.60 MB for the validated materialized pipeline.

Microbenchmarks affected by V8 inlining or escape analysis are documented as regimes, not universal speedup claims.

## Final validation gate

The commit is accepted only after these commands pass on the final tree:

```text
pnpm format:check
pnpm lint:check
pnpm exec tsc --noEmit
pnpm test
pnpm build

cd apps/site
pnpm gen:api-surface
pnpm gen:docs-index
pnpm gen:dts
pnpm gen:lab
pnpm audit:docs
pnpm eval:ghost
```
