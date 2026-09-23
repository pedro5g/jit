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
```

Measurements use warmup, repeated samples, medians, dispersion, and ratios
between candidates in the same process. Critical scenarios compare idiomatic
JavaScript, a handwritten optimized ceiling, runtime JIT, and AOT output, and
also record compile, first-call, steady-state, source-size, and observed heap
signals. Reports include Node, V8, libuv, architecture, platform, CPU,
scenario, source size, and the selected plan.
Absolute nanoseconds are not a gate because they are machine dependent.

An assumption is added only when an implemented compiler decision consumes it.
The initial registry covers fixed-array loop versus unrolling, direct versus
lookup enum membership, numeric enum switches, and collection membership.
Evidence IDs are referenced by strategy candidates; promotion of a baseline is
an explicit command and does not modify compiler thresholds automatically.

The first implementation does not claim a universal speedup. It supplies a
reproducible measurement path and a reviewable place to promote evidence after
running it across supported engine lines.
