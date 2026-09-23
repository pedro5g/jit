# Semantic and physical optimization

Semantic facts are proofs about the declared schema. Examples include exact
length, known keys, enum values, primitive element type, nullability, and a
stable object shape. Facts are normalized independently of builder call order.

Physical strategies are implementation candidates. A candidate must first be
semantically legal, supported on the deployment target, and backed by evidence
admitted by the selected performance profile. Only then does it compete using
a multidimensional integer estimate:

```text
steady runtime · allocations · setup · code size · cold cost
```

The target profile supplies weights and bounded policies. The existing IR cost
optimizer remains responsible for local expression ordering; it is not the
whole-machine performance model.

The current catalog families are fixed-cardinality arrays, fixed tuples, enum
membership, and collection membership lookup. Fixed tuples have their own
positional-check plan; their heterogeneous schemas do not share the array
unroll threshold. Enum strategies preserve the external literal values: small
enums use a direct chain, medium numeric enums can use a statement-level
`switch`, and homogeneous safe enums can use a null-prototype lookup.
Membership candidates encode strict equality versus SameValueZero; `indexOf`,
`Set`, and a reusable index are considered only when their equality and setup
semantics match. Query search and persistent index construction still need
their own measured families before receiving physical selection.

The checked-in target performance profiles currently admit no optimized
evidence. The candidate implementations are available for conformance and
measurement, while compilation selects semantic baselines and explains
optimized candidates as `insufficient-evidence`. A local benchmark report is
not enough to change this policy.

Every decision explains all candidates. The statuses distinguish semantic
illegality, target support, missing evidence, selected, dominated, and higher
estimated cost. The same resolver is used by runtime compilation and AOT; AOT
passes its deployment profile explicitly. Generated code receives the selected
lowering only and contains no target detector or strategy registry lookup.

Semantic and optimization facts remain separate. Schema declarations establish
facts such as exact length and enum values. Execution plans may establish
optimization facts such as lookup reuse or validated inputs. A strategy cannot
infer likely cardinality or uniqueness from observed runtime values.

Every optimized decision carries a stable evidence identifier. Measurements
live in the separate `perf/` harness and include isolated processes, alternating
candidate order, seeded scenarios, repeated samples, median, dispersion, p25/p75,
relative ratios, source size, and a runtime fingerprint. Benchmark results are
reports; profile edits require a separate reviewed source change. The tie-break
is deterministic and ends with the stable strategy id.

Unknown runtimes use the portable profile. AOT receives its target from the
toolchain configuration and never silently inherits the build machine's V8
version. A multi-major range chooses only policies safe across the complete
range. A portable target excludes target-specific candidates.

## Evidence lifecycle

```text
proposed → correctness proven → measured → evidence reviewed
         → profile enabled → monitored → replaced or retired
```

Performance reports and promoted baselines are separate artifacts. Updating a
baseline records a measurement for the current runner; it does not alter a
strategy threshold or the performance profile. A regression gate blocks only a
high-confidence critical regression on a stable, matching environment. Noisy
results and environment changes are reported separately.
