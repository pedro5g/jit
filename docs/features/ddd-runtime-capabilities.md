# DDD Runtime Capabilities

## Problem

Timestamp, soft-delete, and optimistic-version behavior belongs to an
Aggregate Root, but it should not create a second class builder or wrap every
mutation in runtime closures. The class definition resolves lifecycle fields
before the Runtime Class parser and constructor, so JIT can lower the policies
into the same specialized state layout and prototype methods.

Identity follows the same separation of responsibilities: a Unique Identifier
is a scalar Value Object with value semantics. The Entity or Aggregate Root
selects which field is its identity; identity metadata remains available to
the equality, reconciliation, indexing, and query planners without adding
identity methods to the domain instance.

## Canonical API

```ts
const OrderBase = JIT.ddd.abstract
  .aggregateRoot(
    JIT.object({
      id: JIT.ddd.uniqueIdentifier(),
      status: JIT.enum(["draft", "confirmed"]),
    }),
  )
  .extends(JIT.ddd.timestamps(), JIT.ddd.softDelete(), JIT.ddd.versioned());
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
of `create()`. Creation initializes them as
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
`JIT.class.override(value)` is required for an explicit replacement:

```ts
const NamedOrder = OrderBase.extends({
  displayName() {
    return this.status;
  },
});

const CustomOrder = NamedOrder.extends({
  displayName: JIT.class.override(function displayName() {
    return this.status.toUpperCase();
  }),
});
```

The override marker is resolved during declaration and is absent from the
generated class. It can replace a built-in, capability, previous extension, or
schema field; the final value is checked again against any managed-field
contract.

## Runtime and generated design

The capabilities are frozen descriptors installed through the Runtime Class
`.extends()` path. They do not add AST node kinds. Declaration resolves a
`ClassDefinition`, `ResolvedMemberTable`, EffectiveSchema, managed-field plan,
and `ClassLayoutPlan.domainState`; the emitters then bind the final storage
once. The hot methods perform direct property reads and writes against
statically known fields.

The default clock is emitted as `new Date()` and read at most once per
effective lifecycle transition. A custom clock is bound once into the compiled
prototype method. Renamed methods are installed directly on the prototype,
without a dispatcher or per-instance function allocation.

Timestamp writes and version increments happen only after a semantic change.
`touch()` is an explicit mutation. Soft deletion and restoration are explicit
O(1) transitions; repeated transitions return before reading the clock.
Readonly and managed schema fields remain excluded from ordinary `with()`
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

## V5 regression recovery: Runtime Type and validation boundaries

The DDD presets install structural behavior at declaration time. An Entity now
has `equals()` and `hashCode()` by default; an Aggregate Root adds the ordered
typed event buffer and `commit()` surface. Domain methods mutate the protected
`_props` state bag and call lifecycle transitions explicitly. `JIT.class.equals()`,
`hashCode()`, `clone()`, `diff()`,
and `json()` remain explicit callable capabilities for ordinary Runtime
Classes. The callable form is equivalent to the compatible bare descriptor:

```ts
const User = JIT.ddd
  .entity(JIT.object({ id: JIT.string(), email: JIT.string().email() }))
  .extends(JIT.class.clone(), JIT.class.diff(), JIT.class.json());
```

Runtime Types are semantic boundaries shared by equality, hashing, cloning,
diffing, validation, and AOT lowering. Scalar representations compare and
hash their `value`; object representations recurse through their inner schema.
Immutable Runtime Types are reused by clone, while mutable nested Runtime
Types are rebuilt through the internal trusted materializer. No operation
turns a Runtime Type into a plain object or calls a nested public factory.

DDD factory validation is opt-in. `create()` still applies defaults,
coercions, transforms, nested Runtime Type materialization, and class layout
without executing schema checks. `.validate()` enables the shared
`ValidationPlan` for the selected factory phases. A validated nested Runtime
Type enables checks only for that child; it does not activate sibling checks or
create a nested result wrapper. `hydrate()` never regenerates persisted
defaults. The materializer and validator therefore have separate compilation
paths, and successful paths allocate neither issue arrays nor result wrappers.

Mutable class `hashCode()` methods are deliberately uncached, so a mutation
cannot leave a stale hash. Immutable scalar Value Objects may use the existing
structural cache. Class `clone()` and `diff()` are direct method-specialized
compilers; clone re-enters `__jitMaterialize` to preserve the receiver's
prototype and diff reads the same Runtime Type-aware IR as standalone diff.

The AOT host reconstructs the same descriptors, including scalar Value Objects,
Unique Identifiers, Entities, Aggregate Roots, and domain events. Unvalidated
DDD AOT factories emit materialization-only code; validated factories emit the
same checks and failure channel as runtime JIT. Runtime-bound custom methods,
clocks, factories, and error constructors remain explicit skip reasons.

## Complexity, allocations, and measurement

- Declaration resolves lifecycle fields and emits each prototype transition
  once per installed timestamp/version policy; this is compile-time work.
- A domain assignment is one direct state-bag write. `touch()` is O(1), with
  one clock read when timestamps are installed and one version increment when
  versioning is installed.
- No-op checks remain domain-method responsibility; lifecycle no-op transitions
  return before reading the clock or allocating a `Date`.
- Default clocks allocate the one `Date` required by the state transition.
  Injected clocks allocate only what the application clock chooses.
- Capability methods are prototype-shared.

Run `pnpm bench:classes` on an otherwise idle machine. The suite compares the
idiomatic handwritten class, runtime JIT, and standalone AOT for the default
clock, and compares an injected-clock JIT artifact with the equivalent
handwritten call. Results are persisted in `bench/results/classes.latest.json`
with Node, CPU, timing distribution, and sampled heap data. The benchmark is a
regression gate, not a cross-machine latency promise.

Measured on Node 22.17.1 / Ryzen 7 5800H on 2026-09-11 UTC:

| Effective timestamp mutation |         Runtime JIT |                 AOT |         Handwritten |
| ---------------------------- | ------------------: | ------------------: | ------------------: |
| default clock                | 75.22 ns / 112.14 B | 73.24 ns / 112.22 B | 73.95 ns / 112.19 B |
| injected fixed clock         |    1.61 ns / 0.03 B | unsupported binding |    1.05 ns / 0.02 B |

The default-clock result stays within measurement noise of the handwritten
transition because allocating the `Date` dominates it. The injected-clock
result exposes the real binding-call cost: JIT is about 0.65 ns slower than the
handwritten method in this run. The injected clock is a runtime binding and is
intentionally not standalone-AOT reconstructive.

The V3 class-layout scenarios were measured with the same command on the same
machine:

| Scenario                  |        Runtime JIT |                 AOT |       Handwritten |
| ------------------------- | -----------------: | ------------------: | ----------------: |
| DDD getter read           |   0.46 ns / 0.01 B |    0.50 ns / 0.01 B |  0.44 ns / 0.10 B |
| flat entity create        | 14.30 ns / 32.20 B | 11.36 ns / 32.14 B | 6.62 ns / 48.13 B |
| flat entity hydrate       | 13.56 ns / 32.10 B |  6.36 ns / 32.13 B |                 — |
| aggregate domain mutation |   0.87 ns / 0.02 B |                   — |  0.85 ns / 0.02 B |
| aggregate no-op check     |   0.42 ns / 0.01 B |                   — |  0.43 ns / 0.01 B |
| aggregate event buffer*   | 22.73 ns / 184.11 B |                  — | 37.10 ns / 208.09 B |
| custom getter             |   0.45 ns / 0.04 B | unsupported binding |  0.44 ns / 0.01 B |
| private field read        |   0.33 ns / 0.01 B |    0.32 ns / 0.01 B |  0.46 ns / 0.01 B |
| protected-like field read |   0.32 ns / 0.01 B |    0.33 ns / 0.01 B |  0.43 ns / 0.02 B |
| validated class method    | 14.20 ns / 56.10 B | unsupported binding |  0.45 ns / 0.01 B |

The getter result shows that a prototype accessor over one stable slot is within
measurement noise of direct property access. A validated method includes its
intentional argument/output checks; standalone AOT skips arbitrary method
callbacks rather than serializing their source. Heap figures are sampled by
Mitata and are regression signals, not allocation guarantees across engines.
The event-buffer row uses one pre-materialized event for both implementations;
event construction is measured separately.

Nested Runtime Types use the outer factory's result boundary and lazy issue
collection. Child policies never produce nested tuples or either wrappers. If
the parent has no explicit mode, declaration-time policy resolution chooses the
highest numeric priority; equal priorities use `throw > either > tuple`. A
nested custom error is registered as a candidate, cannot stop sibling
validation, and the outer boundary constructs the single final error after all
independent issues are collected.

## Structural mixins, identity, and JSON

`JIT.class.mixin()` is a structural extension, not a late prototype copy. Its
fields are folded into the same EffectiveSchema and ClassLayoutPlan as fields
declared by the host. A Runtime Type field therefore keeps all four declared
representations: for example, a UUID Value Object is a UUID class in
`Typeof`, but accepts a string in `Input`, `Hydrate`, and `Wire`.

An Entity with no identifier may remain pending while declaration extensions
are applied. Adding exactly one unambiguous identifier field resolves that
state and restores its factories; pending entities do not expose invalid
`create()` or `hydrate()` factories. Identity metadata remains internal to
equality, reconciliation, indexing, and query planning. An explicit identity
remains authoritative and is never replaced by a later mixin.

`JIT.class.json()` adds a reconstructive `toJson(): string` capability. The
serializer is compiled once from `Wire<EffectiveSchema>` and the class layout
keeps semantic field access specialized, so the method does not call
`JSON.stringify(this)` or compile a generic serializer on each invocation.
Private and protected persisted fields remain serializable; visibility is not
redaction. `noConstructor()` fields are transient and are excluded from wire
output. The same serializer lowering is emitted for standalone AOT artifacts.

## Current runtime benchmark

The measurements below were produced by `pnpm bench:classes` on Node
22.17.1 / Ryzen 7 5800H on 2026-09-11. Each cell is `ns/op / sampled B/op`.
The handwritten-equivalent rows perform the same validation and nested
materialization. The trusted rows omit validation and are ceilings, not fair
API comparisons. Required instance and Value Object allocations are not
counted as avoidable overhead.

| Scenario                   |       Runtime JIT |                  AOT | Handwritten-equivalent | Handwritten-trusted |
| -------------------------- | ----------------: | -------------------: | ---------------------: | ------------------: |
| nested entity hydrate      | 499.32 / 723.21 B |    129.26 / 312.14 B |      437.09 / 320.53 B |   118.63 / 264.39 B |
| scalar Value Object create |   41.52 / 32.24 B |      35.33 / 32.13 B |                      — |     35.23 / 32.15 B |
| validated class method     |   14.20 / 56.09 B | unsupported callback |                      — |       0.47 / 0.01 B |
| class `toJson()`           |   62.63 / 261.04 B |      55.23 / 230.21 B |                      — |                   — |

Nested hydration is within the initial 2x handwritten-equivalent gate in this
run (1.14x runtime and 0.30x AOT); benchmark variance is visible in the
sampled handwritten baseline, so the saved artifact is the source of truth for
this machine/run. The trusted row shows the remaining
validation/materialization ceiling. The class serializer beats the external
generic JIT serializer in the same run (148.57 ns/op) and
uses the physical layout, but native `JSON.stringify` and a handwritten
serializer are not equivalent because symbol-backed managed storage is not
visible to them. Validated methods retain the intentional validation cost and
remain a follow-up optimization target for fixed-arity inline emission.

The accepted factory-policy samples also show the failure-only `either`
contract: the unconfigured throwing factory measured 61.27 ns / 40.24 B and
the runtime `either` factory 68.48 ns / 40.27 B. The success result is the
instance itself; there is no `{ ok: true, value }` allocation. The extra work
is declaration-selected policy handling, while the failure-only object and
issue list remain confined to rejection.

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
