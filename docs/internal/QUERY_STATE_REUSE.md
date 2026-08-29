# Query boundaries and compiled state — reuse audit

Updated: 2026-08-29

This is the Milestone 0 audit for the query-boundary, mutation-planning and
compiled-dataflow phase. It records what already exists, what can be reused
without changing generated behavior, and the boundaries that must not grow a
second engine.

## Current public surface

| Intent | Current API | Target API | Migration decision |
| --- | --- | --- | --- |
| Trusted application query | `JIT.cqrs.query` | `JIT.cqrs.query` | Keep unchanged. |
| Untrusted query definition/parser | `JIT.cqrs.input` + `JIT.cqrs.parse` | `JIT.api.query` | Move the capability out of CQRS; do not retain the old public names. |
| Immutable update | `JIT.update` | `JIT.state.update` | Move the same factory first; extract `MutationPlan` afterwards. |
| Merge/JSON patch | `JIT.patch.*` | `JIT.state.patch.*` | Move the namespace unchanged. |
| Collection reconciliation | `JIT.reconcile` | `JIT.state.reconcile` | Move the descriptor-backed plan unchanged. |
| Snapshot watch | `JIT.watch` | `JIT.state.watch` | Move the compiled watcher unchanged. |
| Stateful watched list | `JIT.watchedList` | `JIT.state.watchedList` | Keep the capability under state; it remains distinct from compiled `watch`. |
| Comparison and masks | `JIT.compare.*` | `JIT.compare.*` | Keep unchanged. `changed` supplies the first `ChangeLayout`. |

`JIT.state.collection` and `JIT.state.derive` do not exist yet. They must not
be introduced as placeholders: each appears only with its descriptor, runtime,
define and AOT lowering.

## Query-boundary reuse

`packages/jit/src/factories/cqrs.ts` already contains a partial boundary:

- `CqrsInputOptions` is deny-by-default for filter and sort fields;
- nested paths are validated against the schema;
- duplicate fields/operators and malformed configuration are rejected;
- request keys, filter count, condition count, projection count, sort count,
  cursor ordering and page limits are checked;
- `emitCqrsInputParser` generates direct field/operator branches;
- invalid input falls through to a reference parser at runtime and throws
  directly in import-free AOT;
- the result is normalized data, and the registered `cqrs-input` /
  `cqrs-parser` artifacts are reconstructive;
- the structural `~query` descriptor remains version 1.

The existing parser is the implementation to migrate. It is not sufficient as
the final `QueryBoundary` because its operators are `string[]`, `true` means a
special equality shorthand, projection is all-or-nothing, and it has no
explicit relation/collection/logical/cost model. Milestone 2 must introduce an
immutable internal boundary descriptor around this implementation, then later
parser milestones can add those capabilities without creating another query
AST. Parsed predicates continue to lower to `QueryConditionNode` and standard
V1 query data.

## Read dependencies

Reusable sources of read paths already exist:

- `ProjectionTree` validates and normalizes selected paths;
- `MapperPlan` carries required source fields;
- query/rules/access conditions contain field and param nodes;
- Rules already records exact subject/input dependencies per declaration;
- `ChangedDescriptor.tree` resolves nested schema paths in deterministic order.

The shared abstraction should be a small immutable `PathSet`/`ReadSet` built
from normalized path segments. It must be derived from those descriptors and
must not replace their semantic IRs.

## Update and mutation reuse

The current update pipeline is:

```text
schema
  -> buildUpdateIR
  -> UpdateIRProgram
  -> emitUpdate
  -> lazy/cacheable specialized function
```

The emitter already provides the important baseline guarantees:

- scalar writes compare before assignment;
- object/tuple/array branches allocate only after a child changes;
- unchanged branches retain their references;
- an entirely unchanged update returns the root reference;
- known object fields are emitted directly, without path walking;
- recursive schemas use hoisted helpers;
- Runtime Types remain atomic and keep their prototypes;
- runtime/define/AOT and access-authorized update paths already exist.

Therefore `MutationPlan` is extracted above or alongside `UpdateIRProgram`.
The existing generic deep-patch update remains one specialization. Static
`set`/`patch` mutations add explicit read/write metadata and selective result
channels without replacing `emitUpdate` until compatibility and benchmark
coverage proves the replacement.

The first mutation optimization baseline is already good: delayed allocation
and structural sharing must remain byte/behavior compatible during extraction.
Dead writes and same-parent fusion apply to the future static mutation nodes,
not to an opaque runtime patch whose keys are known only per call.

## Write dependencies and change layout

No shared `WriteSet` exists. Update IR knows schema shape but not a static set
of writes for runtime patches. Static mutation nodes must carry normalized
writes as they are declared.

`packages/jit/src/compiler/changed.ts` is the existing `ChangeLayout` seed:

- `ChangedDescriptor.fields` fixes path-to-bit order;
- masks use int32 through 31 fields and bigint afterwards;
- structural leaves bind their schema-specialized equality;
- `ProjectionTree` resolves nested paths;
- `has(mask, path)` uses the same bit positions;
- runtime and AOT already reconstruct the descriptor.

Extracting `ChangeLayout` must preserve the current mask values and source.
Mutation, derive and watch may consume the shared layout only after differential
tests prove equality with `JIT.compare.changed`.

## Patch, reconcile and watch

- `patch` has schema-backed merge-patch and JSON-patch descriptors and AOT.
  It remains the public patch application contract under `JIT.state.patch`.
- `reconcile` is already an immutable descriptor with selective result,
  visitor and iterator sinks. It builds one previous-side key map and performs
  no comparison/diff work for disabled channels.
- `watch` emits a keyed two-snapshot comparison for arrays, sets and maps. Its
  callback bindings are an existing AOT boundary; callback-free artifacts are
  portable. It currently allocates all result channels and does not consume a
  compatible change token.
- `watchedList` is stateful runtime infrastructure and is not an AOT compiled
  function. Namespace migration does not change that contract.

These implementations move as capabilities; they are not folded into
`MutationPlan`. Later ChangeLayout integration may remove redundant comparison
work without changing their result semantics.

## Physical access reuse

`resolveKeyedAccessChoice` in `compiler/physical-query.ts` already chooses:

```text
ordered + unique key -> BinarySearch
cached identity key  -> CachedIndexLookup
otherwise            -> EarlyExitScan
```

CQRS terminals and `JIT.lookup` share this resolver and the same binary/index
emitters. This is the existing AccessPath planner. Milestone 12 should extract
it into a neutral module/name and add the position-oriented emit shape required
by collection mutation. It must retain the rule that a one-off rebuilt index is
slower than a scan.

The current cache maps keys to row values. Immutable array replacement needs a
position. Do not introduce a second cached representation until a benchmark
compares key-to-position against locating the cached row's position. Binary
search already yields a position internally and should expose that compiler
shape without another search implementation.

## AOT/artifact implications

Existing reconstructive kinds cover CQRS boundary definition/parser, update,
patch, changed, reconcile, watch, lookup and query. Namespace migration changes
discovery names, not descriptors or generated source.

New public capabilities require new immutable artifact descriptors only when
their semantics differ:

- `QueryBoundary` replaces the current anonymous CQRS input definition;
- static `MutationPlan` carries nodes, read/write sets and requested channels;
- collection mutation carries its semantic operation and chosen access facts;
- derived state carries a computation artifact plus inferred `ReadSet` and
  optional `ChangeLayout` identity.

Generated output must never retain builders, schema walkers, plan walkers,
operator registries, path registries or JIT imports.

## Sequencing constraints

1. Move namespaces while retaining the existing compiler outputs.
2. Introduce `QueryBoundary` as immutable IR around the existing parser.
3. Complete boundary typing/limits/cost/access before mutation extraction.
4. Extract `MutationPlan` with byte/benchmark regression gates.
5. Introduce shared `PathSet`/`ReadSet`/`WriteSet` metadata.
6. Generalize the existing keyed access resolver for position access.
7. Add array mutation operations and only then selective change outputs.
8. Extract `ChangeLayout` without changing current mask semantics.
9. Build derived state on existing projection/mapper/query artifacts.

At every step runtime, define and AOT move together. Namespace migration is
the only intentionally breaking surface change; semantic compilers remain
unchanged until their replacement has differential and measured coverage.
