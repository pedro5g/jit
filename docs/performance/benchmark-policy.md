# Benchmark policy

Correctness tests establish semantics. Performance measurements check whether
an already-correct strategy remains a useful implementation choice. A
benchmark cannot replace differential tests, update a profile automatically,
or set a universal absolute-time gate.

## Measurement protocol

The shared harness in `perf/harness/` records warmup, paired samples, p25/p75,
median, median absolute deviation ratio, candidate ratio, Node/V8/libuv
fingerprint, architecture, platform and CPU model. Isolated measurements use a
fresh process for each process sample and alternate candidate order inside the
process. Candidates share the same scenario input and consume return values.
Inputs are deterministic and selected by scenario parameters.

Compile time, first-call time, steady time, source bytes and observed heap delta
are reported separately. A heap delta is a trend signal, not an exact allocation
count. Runtime JIT and AOT variants are measured beside an idiomatic reference
and an independently handwritten ceiling where applicable.

## Confidence and gates

The current reporting policy classifies results as winner, likely winner, tie,
or unstable. A candidate promotion should have at least a five percent relative
advantage that repeats across multiple processes and engine runs. Results
inside a three percent tie zone are not treated as meaningful. A blocking
regression requires at least an eight percent relative slowdown, dispersion at
or below three percent, at least five processes and 45 paired samples, a
critical scenario, and a matching environment. These values are initial CI
policy and must be recalibrated from runner history rather than treated as
universal statistical guarantees.

Engine, CPU, architecture or operating-system drift is reported separately from
a performance regression. Low-confidence results warn and retain their report.
Nightly runtimes are informational. A baseline update is explicit and records
the runner fingerprint, commit and date; it never updates a performance
profile.

## Reproduction

Every report identifies the assumption and scenario. A fixed-array case can be
reproduced with:

```bash
pnpm perf:scenario PERF-ARRAY-001 --runtime /path/to/node \
  --length 5 --element-cost trivial --result fail-last
```

The worker verifies that all child processes use the requested runtime and
returns the exact runtime fingerprint with the measurements.
