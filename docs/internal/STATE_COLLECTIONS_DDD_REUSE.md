# State collections and Runtime Class/DDD — reuse audit

Updated: 2026-08-29

This is the Milestone 0 audit for the State Collections + Runtime Class & DDD
Ergonomics phase. It records the implementation already present after the
compiled-dataflow work and the compiler boundaries the next milestones must
preserve.

## State collections

`JIT.state.collection` already lowers through one reconstructive
`collection-mutation-plan` artifact. Runtime and AOT consume the same emitted
source, and `resolveCollectionMutation` delegates key discovery to the shared
`resolveKeyedAccessChoice` planner:

```text
keyed/indexed  -> CachedIndexLookup
ordered unique -> BinarySearch
otherwise      -> EarlyExitScan
```

The audited baseline provided `updateByKey`, `removeByKey`, `upsert`,
`updateWhere` and `removeWhere`. `updateByKey`/`updateWhere` rebuild a row with
the shared `MutationPlan`; predicates are shared `QueryConditionNode`s. The
emitter delays collection allocation until a row is found and, for updates,
until the element mutation returns a different reference. `append` and
`prepend` already emit exact-size indexed copies.

The positional gap is therefore narrow and should extend the same descriptor
and emitter, not add an array-mutation engine:

```text
insertAt removeAt replaceAt updateAt swap move truncate
```

`updateAt` reuses the element `MutationPlan`. `replaceAt` reuses compiled row
equality. All positional operations retain the existing `(value, params)`
artifact calling convention so runtime, define and AOT stay reconstructive.

The implementation now extends that descriptor with positional and replacement
operations plus read/write/order/identity facts. Positional access is reported
as `DirectPosition`, separately from shared key access planning. Fact repair
for ordered/keyed replacement writes remains a later milestone; it is recorded
as invalidation rather than silently claimed by the positional emitter.

## Runtime Class construction today

`RuntimeClass` currently exposes all three paths at once:

```text
new Class(input)
Class.create(input)
Class.hydrate(state)
```

`JIT.class`, Value Objects, Entities and Aggregate Roots all start with those
factories installed. `.factories()` renames or disables factories but never
closes direct construction. The generated constructor always runs the compiled
validator/default resolver unless its second argument is the internal
`validated === true` shortcut. There is no `ConstructionMode` or private
construction token.

Subclass factories are already correct: `create` and `hydrate` construct
through `new this(...)`, so a subclass instance is returned. The new
construction model must retain that behavior while making the canonical
boundary exact in both types and runtime.

## Input, hydration and materialization

`InputOfSchema` already makes defaulted object properties optional and lowers
a nested Runtime Type to the input of its inner schema. `Hydrate` currently
uses the complete output of the inner schema. The validator emitter already
recognizes `runtimeType` and materializes it through its registered constructor,
including nested object/array traversal.

Create and direct construction always validate and resolve defaults; hydration
uses `compileHydrator`, which disables create-default resolution. That
distinction is preserved. Materialization was built on the existing
validator/materialization emitter rather than adding Entity- or VO-specific
walkers, so a nested Runtime Type is materialized at the known field and array
element by the same pass that validates it.

## Value Objects and identity

`valueObject` currently calls the object-only `createRuntimeClass`, freezes the
instance and installs compiled equality/hash capabilities. Consequently scalar
schemas are rejected and the public type models a primitive intersection with
methods. Scalar VO support requires a deliberate Runtime Type representation
with a readonly `value` accessor and primitive wire lowering; it cannot be a
small type alias change.

Entity and Aggregate Root identity is currently explicit and implemented by
the existing `class.identity(key)` capability. No identifier metadata exists.
`uniqueIdentifier` should therefore introduce one immutable metadata marker on
the Runtime Type descriptor, then identity inference may select a field only
when exactly one candidate exists. Explicit `{ id }` continues to override.

## Factory policies and assertions

Both boundaries already parse: `create` through `compileValidator`, `hydrate`
through `compileHydrator` with defaults disabled. Defaults and nested Runtime
Type materialization come from that pass, so validation cannot be skipped
without changing what a factory produces. `.validate()` therefore selects the
**failure channel** and the phases it covers, not whether the schema is
checked; `compileSafeHydrator` exposes the same hydrate pass with issues
instead of an exception so the two share one compiled function.

Assertions reuse `createConditionBuilder` and `emitQueryConditionSource`: an
invariant is generated comparisons, not a stored callback, and the guard is
absent when nothing was declared. Failures travel through the factory policy
rather than choosing their own shape.

The policy rides on the existing `class` artifact and is re-registered when
`.validate()`/`.assert()` mutate it, so AOT emits the same shaping, the same
error construction and the same guard. A custom error factory is a callback:
unserializable ones skip the artifact with a reason.

`clone` is a capability over the existing `ClonePlan`, off by default for the
reasons the DDD docs give.

## Existing compiler plans to reuse

- validation/defaults/materialization: `compileValidator`, `compileHydrator`
  and the runtime-type branch in `emit-validate`;
- equality/hash/clone: existing `EqualPlan`, `HashPlan` and `ClonePlan`;
- object mutation: `MutationPlan` and `emitMutationBody`;
- collection access: shared `AccessPath` planner and position index shape;
- class AOT: reconstructive `class` artifact plus module-local helpers;
- Domain Events and aggregate mutation: current Runtime Class machinery.

No validation, clone, assertion, identity lookup or materialization compiler
specific to DDD should be introduced.

## Safe sequencing

1. Complete positional collection operations through the current descriptor.
2. Add semantic replacements and predicate replacements through the same plan.
3. Finish ordering/key preservation and repair.
4. Introduce `ConstructionMode` in Runtime Class descriptors and AOT.
5. Change `JIT.class` and DDD defaults only with type/runtime/AOT differential
   coverage in the same commit.
6. Add scalar VO/identifier metadata before identity inference.
7. Consolidate create/hydrate materialization before adding validation result
   policies or assertions.
