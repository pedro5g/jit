# Compiler performance assumptions

Functional tests establish semantic correctness. The `perf/` suite checks the
premises used by physical strategy selection. It is intentionally separate
from `pnpm test` and `pnpm quality:*`.

```bash
pnpm perf:assumptions
pnpm perf:engines
pnpm perf:critical
pnpm perf:codegen
pnpm perf:baseline:check
pnpm perf:strategies --smoke
pnpm perf:report
```

Measurements use warmup, paired candidate order, fresh Node processes, repeated
samples, medians, p25/p75, dispersion, and ratios. Critical scenarios compare
idiomatic JavaScript, a handwritten optimized ceiling, runtime JIT, and AOT
output, and separately record compile, first-call, steady-state, source-size,
and observed heap signals. Each return value is consumed so the measured work
remains observable. Reports include Node, V8, libuv, architecture, platform,
CPU, scenario dimensions, source size, and the selected plan.
Absolute nanoseconds are not a gate because they are machine dependent.

An assumption is added only when an implemented compiler decision consumes it.
The registry describes fixed-array loop versus unrolling, direct versus lookup
enum membership, numeric enum switches, and collection membership. It records
hypotheses, not measurements. The fixed-array matrix varies length, element
cost, and success/failure position. The engine report is a deterministic
comparison of checked-in target policies; it is not a benchmark result.
Optimized candidates stay disabled until a reviewed measurement is added to a
target performance profile. `pnpm perf:baseline:update` records a run for the
current engine; it does not modify compiler thresholds or profiles.

The current profile is an initial, explicitly versioned policy. The ignored
`perf/results/` directory holds regenerable runs; `perf/baselines/` is committed
only after an explicit promotion. A profile proposal is a human-reviewed source
diff with evidence references. A measured result cannot update compiler
behavior by itself. See [benchmark policy](./benchmark-policy.md) and
[target profiles](./profiles.md).
