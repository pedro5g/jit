# Schema migrations

## 1. Problem

A mapper converts one shape into another. A migration must additionally accept several historical versions, choose the correct starting edge, apply every remaining edge in order, and expose enough metadata to generate the same dispatch ahead of time.

## 2. Why JIT

Every schema declares a literal `version`, and every edge is already expressible as a MapperPlan. JIT can compile the chain once into a version `switch` with fallthrough instead of looking up and iterating a runtime edge registry on every event.

## 3. API

```ts
const migrateUser = JIT.migrate(UserV1)
  .to(UserV2, { fullName: { from: "name" } })
  .to(UserV3, {
    displayName: { from: "fullName" },
    active: { default: true },
  });

migrateUser(v1); // UserV3
migrateUser(v2); // UserV3
migrateUser(v3); // the same reference
```

The input type is the union of every declared version and the output is always the current schema. The `version` field is owned by the plan: each edge writes its target literal automatically.

## 4. Semantics

Schemas must be objects with a string or number literal field named `version`. Versions cannot repeat. An input at version N runs edges N→N+1 through current; the current version is returned untouched. Unknown versions and non-object inputs throw.

This also fits domain-event envelopes because `JIT.ddd.domainEvent` declares a literal numeric version.

## 5. Compilation

Each `.to()` builds the existing MapperPlan for that source/target pair. The MigrationDescriptor stores the ordered schemas, literal versions, mapper fields, and external bindings. Lowering emits one switch and one hoisted mapper function per edge.

## 6. Generated code

```js
function migrate(value) {
  switch (value.version) {
    case 1:
      value = migrateEdge0(value);
    case 2:
      value = migrateEdge1(value);
    case 3:
      return value;
    default:
      throw new RangeError("unsupported migration version");
  }
}
```

There is no edge array, registry lookup, callback dispatch loop, or schema walker.

## 7. Allocation model

The current version allocates nothing and preserves identity. An older version allocates one target object per remaining MapperPlan edge. Those intermediate objects are semantic boundaries: a later mapping callback can observe the complete output of the previous edge, so fusing them away would change behavior.

## 8. Complexity

Dispatch is O(1); execution is O(remaining edges × mapped fields). It does not scan edges that precede the input version.

## 9. Physical strategies

`VersionSwitch` is the only current strategy. A generic loop is deliberately absent because versions are compile-time literals.

## 10. AOT

Runtime and define register the same `migration-plan`. Generated JS/TS contains the switch and mapper bodies without importing JIT. Self-contained mapping callbacks are reconstructed as module-local bindings; native, bound, or closure-dependent callbacks produce an explicit skip reason.

## 11. Runtime/AOT parity

Tests cover V1, intermediate, current and unknown inputs on runtime, define and generated output. Generated TypeScript accepts the union of version schemas and returns the current schema.

## 12. Benchmarks

Reproduce with `pnpm bench:migration`. Apple M1, Node 22.22.3:

| Input | Runtime JIT | AOT | Handwritten switch | Generic edge loop |
| --- | ---: | ---: | ---: | ---: |
| V1 → V3 | 5.79 ns | 5.42 ns | 12.20 ns | 36.35 ns |
| V2 → V3 | 2.39 ns | 2.43 ns | 2.22 ns | 28.09 ns |
| V3 → V3 | 0.413 ns | 0.412 ns | 0.428 ns | 23.12 ns |

The handwritten switch is the optimization ceiling and can win; nanosecond measurements are especially sensitive to engine inlining. The stable result is structural: runtime and AOT remain in the same band, while both avoid the generic loop's array iteration and dispatch. Sampled allocation fell from 271/223/167 bytes in the generic cases to 54/28/~0 bytes in the corresponding runtime cases. Current-version input stays at handwritten parity and allocates nothing.

## 13. Tradeoffs

Migration is sequential by design. Long chains can accumulate allocations; periodically squashing historical edges into a direct import migration is an application decision, not an implicit optimizer rewrite.

## 14. Best practices

Keep versions monotonic and mapping callbacks self-contained. Test every supported starting version. Validate untrusted wire input before migration when its shape cannot be trusted.

## 15. Non-goals

This is not arbitrary graph routing, database DDL migration, downgrade support, or an event store. It does not infer versions from field presence.
