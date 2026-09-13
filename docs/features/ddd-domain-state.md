# DDD Domain State, Typed Events, and Typeof

## Problem and rationale

DDD objects need two different views of one effective schema. Callers should
see readonly domain properties, while domain methods need a trusted and typed
way to perform controlled mutation. A field-by-field private slot model makes
that boundary expensive to maintain and forces every compiler operation to
understand another physical representation.

JIT resolves the effective schema and its capabilities at declaration time,
then lowers one domain-state layout. The generated runtime and AOT classes use
the same state bag, while equality, hashing, cloning, diffing, JSON, and
lifecycle code continue to operate on semantic schema fields.

## Canonical API and semantics

```ts
const ChangeName = JIT.ddd.domainEvent("user.name-changed", {
  version: 1,
  payload: JIT.object({ oldName: JIT.string(), newName: JIT.string() }),
});

const UserBase = JIT.ddd
  .aggregateRoot(JIT.object({ id: JIT.string(), name: JIT.string() }), {
    id: "id",
  })
  .events(ChangeName)
  .extends(JIT.ddd.timestamps(), JIT.ddd.versioned());

class User extends UserBase {
  rename(name: string): void {
    if (this._props.name === name) return;
    const event = ChangeName.create({
      oldName: this._props.name,
      newName: name,
    });
    this._props.name = name;
    this.touch();
    this.raise(event);
  }
}
```

`_props` is a protected, readonly reference to the materialized runtime state.
The reference cannot be replaced, ordinary domain fields are mutable, and
identity, managed lifecycle fields, and explicit readonly schema fields are
readonly in the state type. Public schema accessors remain readonly unless a
custom setter is explicitly declared. Assignment is trusted domain code: it
does not parse, validate, walk descriptors, or dispatch through a generic
mutation gate.

An aggregate's event type is inferred from `.events(EventA, EventB)` or can be
provided as `.events<UserEvent>()`. `raise`, `peekEvents`, `pullEvents`, and
`commit` retain that union. Domain events carry a type-only brand; the event
buffer is an ordered private array and `raise` performs only the push. Event
emission does not imply a lifecycle mutation. `touch` is available for
timestamps, versioning, or both, and reads a configured clock once when a
timestamp transition needs it.

The old aggregate `update()` and public `identity()`/`sameIdentity()` surfaces
are intentionally absent. Class `with()` and compiler mutation plans remain
available where explicitly configured for ordinary Runtime Classes.

## Compiler and physical layout

The declaration pipeline is:

```text
schema + extensions + capabilities
  → ClassDefinition
  → EffectiveSchema
  → ClassLayoutPlan.domainState
  → specialized Runtime/AOT source
```

DDD layout facts record symbol storage and mutable/readonly field sets. One
materialized state object is attached to one hidden symbol slot. Public getters
read known state properties directly; trusted generated operations can bind
the same slot directly. `_props` is a prototype getter over that slot, so it
does not create a string-named own member or a second copy of field values.
The event buffer uses a separate hidden symbol and is never serialized.

Create and hydrate materialization reuse the state object produced by the
materializer. Clone creates a new state object, while immutable nested Runtime
Types keep their existing sharing semantics. JSON, diff, equality, and hashing
enumerate effective semantic fields and never expose `_props`, symbols, or
events. AOT emits the same symbol-backed getters, constructor attachment,
lifecycle methods, and typed aggregate buffer without retaining the schema
walker or runtime compiler.

The implementation measured both layouts with the same ten-field operations
and 3/10/25/50/100-field construction cases. The selected Strategy B is the
symbol slot plus protected prototype accessor. Public getters, domain writes,
and ten-read loops were effectively tied after warm-up; raw domain reads pay
one extra dereference in this microbenchmark. Strategy B preserves the
non-enumerable physical boundary and lets generated trusted operations bypass
the accessor. State attachment uses a direct symbol assignment to avoid a
per-instance `defineProperty` call.

Representative Node 22 measurements on an AMD Ryzen 7 5800H are below. These
are physical-layout measurements, not a claim about all application classes;
the complete reproducible output is produced by `pnpm bench:classes:layout`.

| scenario                   | Strategy A | Strategy B |
| -------------------------- | ---------: | ---------: |
| 100 fields / construct     |    3.01 µs |    2.97 µs |
| 100 fields / domain read   |    4.94 ns |    8.69 ns |
| 100 fields / public getter |    5.07 ns |    5.01 ns |
| 100 fields / domain write  |    4.34 ns |    4.31 ns |
| 100 fields / ten reads     |   45.28 ns |   44.88 ns |
| 100 fields / ten writes    |  471.36 ns |  474.19 ns |
| semantic equals            |    7.49 ns |    7.81 ns |
| semantic hashCode          |   28.25 ns |   30.12 ns |
| semantic clone             |   23.55 µs |   20.67 µs |
| semantic diff              |    8.21 ns |    5.36 ns |
| semantic toJson            |    6.50 µs |    6.30 µs |

The measurements include the known tradeoff: the two layouts are close for
the hot public/domain operations, while direct state is faster for an isolated
raw read. Strategy B wins the encapsulation contract and keeps generated
semantic access direct; its construction cost is one symbol slot assignment,
not per-field storage. The symbol is absent from string property enumeration
(`Object.keys` and `Object.getOwnPropertyNames`), and no Proxy, Reflect
dispatch, Map lookup by field, or per-instance closure is used.

## Runtime, define, and AOT

Runtime declarations register the effective schema, lifecycle mutation facts,
domain-state layout, accessors, and reconstructive capabilities. Define hosts
carry the same metadata and `.events(...)` is type/declaration metadata only;
it does not install an event validator. AOT reconstruction emits a standalone
symbol slot, protected `_props` declaration, public getters, lifecycle
transitions, and the ordered event buffer. Event unions and protected
visibility are TypeScript-only; event branding adds no runtime check.

Custom application methods, setters, getters, and clocks remain runtime
bindings unless they use the contextual extension DSL and a reconstructive
capability. AOT never reconstructs a custom method from `Function#toString`.

## Contextual members

TypeScript cannot contextually type a function passed through the current
`JIT.class.public(schema, JIT.class.setter(function (value) {}))` nested call.
The repository's isolated spike demonstrates this limitation without falling
back to `any`. The type-safe fallback is:

```ts
.extends(($) => ({
  isValid: $.field(JIT.boolean().default(true))
    .public()
    .setter(function (value) {
      this._props.isValid = value;
      this.touch();
    }),
}))
```

The callback receives the current effective public/internal contextual
surface, including previous extensions and earlier same-call capabilities.
The no-name overload binds the returned outer object key during declaration;
the explicit `field(name, schema)` overload remains available when the callback
itself needs the exact new key in its contextual type. The resulting runtime
accessor is the same direct prototype accessor used by ordinary descriptors.

## Typeof resolution

`JIT.Typeof` now resolves schema nodes rather than recursively simplifying an
arbitrary object. Objects rebuild their shape, arrays/tuples/sets/maps/records
preserve their containers, unions resolve branch by branch, and optional,
nullable, nullish, default, brand, and effective transform output semantics
remain explicit. Runtime Type schemas are atomic boundaries and return their
materialized instance type. Dates, functions, promises, brands, and special
objects are not expanded by a generic deep mapped type.

The compiler-API display fixture snapshots `User`, `UserList`, `PublicUser`,
`DomainState`, and the event union. It rejects regressions that expose
`BuilderShape`, `TypeofShape`, `BaseBuilder`, or `SchemaCheck` in public type
display. The type-performance fixture covers 10/25/50/100 fields, depths
1/3/5/10, a ten-branch union, collections, and nested Runtime Types.

With TypeScript 6.0.3 on the same workspace, the resolver-directed fixture
measured:

| metric         | previous resolver | schema-directed resolver |
| -------------- | ----------------: | -----------------------: |
| types          |           250,715 |                  250,875 |
| instantiations |           863,678 |                  867,526 |
| memory         |        567,140 KB |               567,482 KB |
| check time     |            5.94 s |                   5.91 s |

The small instantiation increase is the cost of preserving explicit container
and wrapper semantics; check time was slightly lower in this run. Reproduce
with `pnpm exec tsc -p bench/types/tsconfig.before.json --extendedDiagnostics`
and the corresponding `tsconfig.after.json` command.

## Benchmarks and non-goals

The class benchmark suite compares idiomatic JavaScript, a handwritten class,
runtime JIT, and AOT where the scenario supports it, and records nanoseconds,
bytes per operation, and generated behavior. The relevant command is
`pnpm bench:classes`; the physical candidate command is
`pnpm bench:classes:layout`. Generated-source snapshots cover constructors,
getters, equality, hash, clone, diff, JSON, touch, and aggregate event code.

This feature does not add Proxy-based mutation tracking, runtime event-union
validation, a second mutation engine, public identity methods, aggregate
`update()`, or a generic reflection layer. It does not make trusted domain
assignments validate automatically; domain invariants belong in domain methods
or explicit factory boundaries.
