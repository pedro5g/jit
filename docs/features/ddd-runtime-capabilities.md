# DDD Runtime Capabilities

## Problem

Timestamp, soft-delete, and optimistic-version behavior belongs to an
Aggregate Root, but it should not create a second class builder or wrap every
mutation in runtime closures. The schema already identifies the fields and the
Aggregate Root already owns a compiled mutation boundary, so JIT can lower the
policies into that same generated method.

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
      changedAt: JIT.date(),
      archivedAt: JIT.date().nullable(),
      version: JIT.int(),
    }),
  )
  .extends(
    JIT.ddd.timestamps({ updatedAt: "changedAt" }),
    JIT.ddd.softDelete({ field: "archivedAt" }),
    JIT.ddd.versioned({ field: "version" }),
  );
```

Exactly one Unique Identifier field makes the `{ id }` option unnecessary.
Zero or multiple candidates require an explicit identity field. Each DDD
policy is singleton: applying it twice fails in the fluent type when it would
repeat a member and always fails at declaration time in runtime.

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

## Runtime and generated design

The capabilities are frozen descriptors installed through the existing
Runtime Class `.extends()` path. They do not add AST node kinds. Aggregate
configuration rebuilds one `AggregateMutationPlan` during declaration; the hot
`update()` method still performs direct property reads and writes.

The default clock is emitted as `new Date()` and read at most once per
effective mutation. A custom clock is bound once into the compiled update
function. Renamed methods are installed directly on the prototype, without a
dispatcher or per-instance function allocation.

Timestamp writes and version increments happen only after a semantic change.
Soft deletion and restoration are explicit O(1) writes. Readonly schema fields
remain excluded from ordinary update patches.

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

Measured on Node 22.17.1 / Ryzen 7 5800H on 2026-08-30:

| Effective timestamp mutation | Runtime JIT | AOT | Handwritten |
| --- | ---: | ---: | ---: |
| default clock | 72.42 ns / 112.31 B | 71.11 ns / 112.18 B | 73.03 ns / 112.24 B |
| injected fixed clock | 3.26 ns / 0.04 B | unsupported binding | 1.01 ns / 0.02 B |

The default-clock result is at the handwritten ceiling because allocating the
`Date` dominates the transition. The injected-clock result exposes the real
binding-call cost: JIT is about 2.25 ns slower than the handwritten method in
this run. That is the price of a caller-supplied clock and is reported plainly;
the default path does not pay it.

## Tradeoffs and non-goals

- Capabilities do not add missing fields to a schema. Timestamp and deletion
  fields remain explicit domain state; creation defaults belong on their
  schemas.
- A custom clock intentionally gives up standalone AOT until JIT has an
  explicit external-module binding contract.
- Soft delete is domain state, not repository filtering. CQRS/access policies
  decide whether deleted rows are visible.
- Versioning increments in memory; persistence conflict detection belongs to
  the repository.
- Unique Identifier metadata is not a database uniqueness check or an identity
  map.
