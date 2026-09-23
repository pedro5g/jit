# Contract-first adaptive compiler

JIT's public API describes a contract: a schema, an operation, its input and
output, effects, and failure behavior. The compiler owns the physical choices
needed to execute that contract efficiently. Callers do not select loops,
lookup structures, unrolling, inlining, or generated temporaries.

The stable pipeline is:

```text
SemanticContract → ConstraintModel → SemanticFacts → ExecutionPlan
                 → OptimizationContext → StrategyCatalog → TargetProfile
                 → CostModel → PhysicalPlan → IR → runtime or AOT lowering
```

`ExecutionPlan` remains semantic. A `PhysicalPlan` records only target-specific
decisions and a digest, so explanations can show both layers without making
generated source the API's mental model.

## Deterministic decisions

Plan identity is a function of the normalized contract, semantic and
optimization facts, target profile, strategy catalog version, performance
profile version, and extension set. Metadata that no lowering declares as a
dependency and presentation settings such as locale stay outside that identity.
Cost estimates use non-negative integer units; no floating-point benchmark
result participates in compilation.

Every strategy family records its candidates, legality checks, target checks,
evidence checks, integer estimate and rejection reason. Eligible candidates are
ranked by the profile-weighted score, then allocation, cold cost, code size,
portability and stable family/strategy identity. A candidate is never selected
because a benchmark just ran on the current machine.

Four inputs remain distinct:

- **Semantic facts** are proofs from the schema, such as exact cardinality,
  element type, nullability and enum values.
- **Optimization facts** are proofs from the whole execution plan, such as a
  reusable index or an earlier validation stage.
- **Target profiles** describe the deployment/runtime capabilities that code
  generation may rely on.
- **Performance evidence** is reviewed, versioned empirical knowledge. It may
  admit or reject a candidate, but does not change the contract.

At runtime, the host detects its engine before planning and passes an immutable
profile to compilation. Detection is absent from the emitted function. AOT
resolves only an explicit deployment target or a known portable profile; the
Node process that runs the generator is not a deployment target. A Node range
is resolved conservatively across every known profile it can match.

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

An omitted or unbounded AOT target resolves to the portable profile. Supported
Node-major profiles currently include 22, 24 and 26. Profile changes are
deliberate source changes with a new performance-profile version and evidence
references; benchmark and baseline commands never edit these compiler inputs.

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
