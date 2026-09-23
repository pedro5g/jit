# Semantic and physical optimization

Semantic facts are proofs about the declared schema. Examples include exact
length, known keys, enum values, primitive element type, nullability, and a
stable object shape. Facts are normalized independently of builder call order.

Physical strategies are implementation candidates. A candidate must first be
semantically legal and only then compete using a multidimensional estimate:

```text
steady runtime · allocations · setup · code size · cold cost
```

The target profile supplies weights and bounded policies. The existing IR cost
optimizer remains responsible for local expression ordering; it is not the
whole-machine performance model.

The first catalog families are fixed-cardinality array validation and enum
membership. For a small primitive array, the planner may select unrolled
property checks. For a complex element or a larger cardinality it retains the
indexed loop. Enum strategies preserve the external literal values: small
enums use a direct chain, medium numeric enums may use a statement-level
`switch`, and larger safe enums may use a null-prototype lookup. An internal
ordinal representation is not exposed without a later explicit
representation contract.

Every decision carries a stable evidence identifier. Measurements live in the
separate `perf/` harness and include warmup, repeated samples, median,
dispersion, relative ratios, source size, and a runtime fingerprint. A tie is
resolved by code size, allocation, compile cost, and portability rather than
by chasing noise.

Unknown runtimes use the portable profile. AOT receives its target from the
toolchain configuration and never silently inherits the build machine's V8
version.
