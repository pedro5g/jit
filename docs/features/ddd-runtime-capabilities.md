# DDD Runtime Capabilities

## Problem

Timestamp, soft-delete, and optimistic-version behavior belongs to an
Aggregate Root, but it should not create a second class builder or wrap every
mutation in runtime closures. The class definition resolves lifecycle fields
before the Aggregate Root's parser, constructor, and compiled mutation
boundary, so JIT can lower the policies into that same generated method.

Identity follows the same separation of responsibilities: a Unique Identifier
is a scalar Value Object with value semantics. The Entity or Aggregate Root
selects which field is its identity and owns `identity()`/`sameIdentity()`.

## Canonical API

```ts
const OrderBase = JIT.ddd
  .abstract.aggregateRoot(
    JIT.object({
      id: JIT.ddd.uniqueIdentifier(),
      status: JIT.enum(["draft", "confirmed"]),
    }),
  )
  .extends(
    JIT.ddd.timestamps(),
    JIT.ddd.softDelete(),
    JIT.ddd.versioned(),
  );
```

Exactly one Unique Identifier field makes the `{ id }` option unnecessary.
Zero or multiple candidates require an explicit identity field. Each DDD
policy is singleton: applying it twice fails in the fluent type when it would
repeat a member and always fails at declaration time in runtime.

Capabilities resolve their canonical fields before any parser, hydrator,
constructor, factory, or accessor is compiled. A missing field is injected, a
compatible field is reused, an augmentable field is completed, and an
incompatible field fails with `DDD_CAPABILITY_SCHEMA_CONFLICT`. The resulting
EffectiveSchema contains `createdAt: Date`, `updatedAt: Date | null`,
`deletedAt: Date | null`, and `version: number` in the example above.

Managed fields are required in `hydrate()` and omitted from the user portion
of `create()` and `update()`. Creation initializes them as
`createdAt = clock()`, `updatedAt = null`, `deletedAt = null`, and `version = 0`.
Hydration consumes persisted values and never regenerates them.

Method names and time sources are configurable:

```ts
const clock = () => new Date("2026-01-01T00:00:00.000Z");

const timestamps = JIT.ddd.timestamps({
  updatedAt: "changedAt",
  clock,
  methods: { touch: "markChanged" },
});

const deletion = JIT.ddd.softDelete({
  field: "archivedAt",
  clock,
  methods: {
    delete: "archive",
    restore: "unarchive",
    isDeleted: "isArchived",
  },
});
```

Names cannot shadow schema fields, factories, Aggregate Root infrastructure,
or an installed capability. The configured clock must return a valid `Date`.

`.extends({...})` is sequential and accumulates the complete class surface. A
later extension sees schema fields, preset members, capability methods, and
earlier extensions. Ordinary members cannot shadow an existing member;
`JIT.overwrite(value)` is required for an explicit replacement:

```ts
const NamedOrder = OrderBase.extends({
  displayName() {
    return this.status;
  },
});

const CustomOrder = NamedOrder.extends({
  displayName: JIT.overwrite(function displayName() {
    return this.status.toUpperCase();
  }),
});
```

The overwrite marker is resolved during declaration and is absent from the
generated class. It can replace a built-in, capability, previous extension, or
schema field; the final value is checked again against any managed-field
contract.

## Runtime and generated design

The capabilities are frozen descriptors installed through the Runtime Class
`.extends()` path. They do not add AST node kinds. Declaration resolves a
`ClassDefinition`, `ResolvedMemberTable`, EffectiveSchema, and managed-field
plan; aggregate configuration then rebuilds one `AggregateMutationPlan`. The
hot methods perform direct property reads and writes against statically bound
fields.

The default clock is emitted as `new Date()` and read at most once per
effective mutation. A custom clock is bound once into the compiled update
function. Renamed methods are installed directly on the prototype, without a
dispatcher or per-instance function allocation.

Timestamp writes and version increments happen only after a semantic change.
`touch()` is an explicit mutation. Soft deletion and restoration are explicit
O(1) transitions; repeated transitions return before reading the clock.
Readonly and managed schema fields remain excluded from ordinary update
patches and direct managed writes are rejected by the generated accessors.

## Representations and abstract bases

`JIT.Typeof` describes materialized runtime state. Therefore a field declared
with `JIT.ddd.uniqueIdentifier()` is a `ScalarValueObject<string>` at runtime.
`JIT.Input`, `JIT.Hydrate`, and `JIT.Wire` describe scalar boundary forms.
Changing `Typeof` to `string` would disagree with the value returned by parse,
create, and hydrate.

An abstract DDD base rejects direct `create()` and `hydrate()` calls. Those
static factories remain on the base so subclasses inherit one canonical
construction boundary; invoking them through a concrete subclass constructs
that subclass.

## Runtime, define, and AOT

Default-clock capabilities are reconstructive and preserve runtime/define/AOT
semantics and configured names. Standalone AOT never captures an application
clock. A class carrying one is skipped in full with a `class.extends` reason,
rather than dropping the policy or reconstructing a closure from source text.

## Complexity, allocations, and measurement

- Declaration recompiles the Aggregate Root mutation method once per installed
  timestamp/version policy; this is compile-time work.
- An effective timestamped mutation is O(number of statically known mutable
  fields), exactly like the underlying compiled mutation, plus one clock read.
- An ineffective mutation returns before reading the clock or allocating a
  `Date`.
- Default clocks allocate the one `Date` required by the state transition.
  Injected clocks allocate only what the application clock chooses.
- Capability methods are prototype-shared.

Run `pnpm bench:classes` on an otherwise idle machine. The suite compares the
idiomatic handwritten class, runtime JIT, and standalone AOT for the default
clock, and compares an injected-clock JIT artifact with the equivalent
handwritten call. Results are persisted in `bench/results/classes.latest.json`
with Node, CPU, timing distribution, and sampled heap data. The benchmark is a
regression gate, not a cross-machine latency promise.

Measured on Node 22.17.1 / Ryzen 7 5800H on 2026-09-04 UTC:

| Effective timestamp mutation | Runtime JIT | AOT | Handwritten |
| --- | ---: | ---: | ---: |
| default clock | 73.03 ns / 112.23 B | 69.85 ns / 112.21 B | 72.99 ns / 112.19 B |
| injected fixed clock | 3.99 ns / 8.02 B | unsupported binding | 1.00 ns / 0.02 B |

The default-clock result is at the handwritten ceiling because allocating the
`Date` dominates the transition. The injected-clock result exposes the real
binding-call cost: JIT is about 3.00 ns slower than the handwritten method in
this run. The default path stays within measurement noise of the handwritten
transition; the injected clock is a runtime binding and is intentionally not
standalone-AOT reconstructive.

Nested Runtime Types use the outer factory's result mode and lazy issue
collection. Child `result` and `tuple` policies do not leak through
composition. A nested custom error is registered as a late candidate (default
priority 800); it cannot stop sibling validation, and the outer boundary
constructs the single final error after independent issues are collected.

## Tradeoffs and non-goals

- Capabilities own only their canonical lifecycle fields. Explicit compatible
  declarations are reused, augmentable declarations are completed, and
  contradictory declarations are rejected rather than silently reinterpreted.
- A custom clock intentionally gives up standalone AOT until JIT has an
  explicit external-module binding contract.
- Soft delete is domain state, not repository filtering. CQRS/access policies
  decide whether deleted rows are visible.
- Versioning increments in memory; persistence conflict detection belongs to
  the repository.
- Unique Identifier metadata is not a database uniqueness check or an identity
  map.
