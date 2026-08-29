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

The existing parser is the implementation to migrate. Milestone 2 introduced
an immutable internal `QueryBoundary` containing normalized field/operator
capabilities, projection, sorting, pagination and limits. Relations,
collections and logical operations are represented as closed capabilities, so
later milestones can open them explicitly without changing the Query AST. Both
the reference parser and specialized source emitter now consume that
descriptor. The V1 `~query` shape is derived separately and remains unchanged.

The boundary is not yet final: relations, collections and logical input remain
closed. The `true` shorthand is now a distinct capability in the IR rather than
an operator list that happens to be `["eq"]`, so declaring `["eq"]` keeps
accepting an operator object. Operator types now come from the shared Query AST; construction
also rejects non-scalar fields and operators incompatible with the schema.
Projection has an explicit allowlist rather than inheriting every model field.
Operations absent from the Query AST (`in`, `between`, string search) remain
unavailable instead of being represented by boundary-only strings. Structural
limits now cover traversal depth and offset pagination; `maxDepth` is checked
while the descriptor is resolved and `maxOffset` while a request is normalized,
and neither reaches `~query` V1. `QueryCost` adds the semantic budget over
those counters: weights live in `compiler/query-cost.ts`, the default budget is
the worst request the structural limits already allow, and a guard that cannot
fire is not emitted. `resolveApiAuthorization` intersects the boundary with one
access action: the readable field set and the row predicate resolve against the
plan once, and only the actor's own values are read per request. The effective
request is ordinary V1 data — no access node reaches an adapter. Both source emitters take the descriptor as
their only argument, so a limit cannot land in one parser and miss the other.
Parsed predicates continue to lower to `QueryConditionNode` and standard V1
query data.

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

`MutationPlan` is now extracted alongside `UpdateIRProgram` in
`compiler/mutation/`. It describes declared writes to normalized paths, derives
the read/write sets and the copy tree, and runs dead-write elimination,
same-parent fusion and no-op detection before emitting. `emitUpdate` is
unchanged: a declared path is specialized only when the generic update would
assign its leaf, so anything the deep-partial update merges keeps running
through it, and `explain().strategy` reports which one a patch got. The
existing generic deep-patch update remains the general case. Selective result
channels are still to come.

The first mutation optimization baseline is already good: delayed allocation
and structural sharing must remain byte/behavior compatible during extraction.
Dead writes and same-parent fusion apply to the future static mutation nodes,
not to an opaque runtime patch whose keys are known only per call.

## Write dependencies and change layout

`MutationPlan.dependencies` carries the first read and write sets, as
normalized paths, and `changeLayoutBitFor` maps a write onto the layout bit it
sets. They exist only for declared writes; the update IR still
knows schema shape but not a static set of writes for a runtime patch, which is
the correct boundary. A shared `PathSet` can be lifted from these once derived
state needs to intersect against them.

`packages/jit/src/compiler/changed.ts` is the existing `ChangeLayout` seed:

- `ChangedDescriptor.fields` fixes path-to-bit order;
- masks use int32 through 31 fields and bigint afterwards;
- structural leaves bind their schema-specialized equality;
- `ProjectionTree` resolves nested paths;
- `has(mask, path)` uses the same bit positions;
- runtime and AOT already reconstruct the descriptor.

`ChangeLayout` now exists in `compiler/change-layout.ts`, derived from the same
`ChangedDescriptor` rather than replacing it: the mask values and the emitted
`changed` source are unchanged. A declared patch's `result({changed})` produces
its mask from the comparisons the copy plan already made, and a property test
holds it against `JIT.compare.changed` on random inputs. Forward and inverse
patches come from the same next/previous pairs, in the same pass; a channel
nobody requested is absent from the generated source. Derive and watch can adopt
the layout next.

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

`resolveKeyedAccessChoice` now lives in `compiler/access-path.ts`, which is the
shared planner the audit asked for. It chooses:

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

Immutable array replacement needs a position rather than a row. Instead of a
second cache, `IndexShape` gained a `position` shape: the same builder, the same
key reads and the same cache, storing the row's index. `KeyedEmitShape.answers`
gained `"position"`, so the binary search reports the slot when the key is
present and the bitwise complement of the insertion point when it is not, and
the scan does the same. `emitEarlyExitScan` is now shared: lookup's private scan
was deleted in favour of it, so query, lookup and collection mutation reach a row
through one implementation.

`JIT.state.collection` consumes that planner. `updateByKey` reuses `MutationPlan`
for the row, `upsert` uses schema-specialized equality for its no-op test, and
`updateByKey` refuses to write the identity or ordering key rather than leave a
collection whose declared facts stopped being true. `updateWhere`/`removeWhere`
and explicit rekey/reposition are still to come.

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
