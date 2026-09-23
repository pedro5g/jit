# Contract-first adaptive compiler

JIT's public API describes a contract: a schema, an operation, its input and
output, effects, and failure behavior. The compiler owns the physical choices
needed to execute that contract efficiently. Callers do not select loops,
lookup structures, unrolling, inlining, or generated temporaries.

The stable pipeline is:

```text
contract → normalized constraints → semantic facts → execution plan
         → target-aware physical plan → IR → runtime or AOT lowering
```

`ExecutionPlan` remains semantic. A `PhysicalPlan` records only target-specific
decisions and a digest, so explanations can show both layers without making
generated source the API's mental model.

## Configuration boundary

`JIT.config()` and `JIT.create()` contain observable runtime configuration such
as locale. They do not accept optimization levels, loop policies, or AOT
options. Environments have isolated registries and extension sets while
sharing the factory implementations. A compiled artifact captures the
environment at compilation time; it never reads mutable global configuration
on its hot path.

Toolchain configuration belongs to `jit.config.ts` and selects an explicit AOT
target. Locale and other presentation settings are deliberately excluded from
the executable compilation digest.

## Agent contract

Artifact manifests should expose the public symbol, input, output, effects,
errors, dependencies, protocols, and a physical-plan digest. Strategy details
are explainable on demand, but are not part of the normal contract response.
This lets an agent import a generated symbol without reconstructing the
compiler implementation from emitted JavaScript.

## Non-goals

- exposing raw emitter APIs to application code or plugins;
- making benchmark timings part of runtime behavior;
- runtime autotuning or machine-specific source generation;
- treating descriptive metadata as executable schema semantics.
