# Target and performance profiles

Target profiles describe code generation capabilities. Performance profiles hold
reviewed evidence references. The two inputs have separate versioned digests
and both participate in the `PhysicalPlan` digest and compilation cache key.

## Target profiles

| Profile | Source | Policy |
| --- | --- | --- |
| `portable-1` | Checked-in core profile | Conservative costs and limits; no engine-specific assumptions |
| `node-22`, `node-24`, `node-26` | Explicit deployment range or detected runtime major | Node/V8 target policy with a separately versioned performance profile |
| `node-range-*` | AOT Node range covered by reviewed profiles | Uses the most conservative limit and weight from every matched profile |
| unknown target | Runtime detector or unsupported AOT range | Falls back to `portable-1` |

Runtime detection returns a fingerprint before compilation. It includes the
Node, V8 and libuv versions, architecture, platform and CPU model. Only the
resolved profile is passed into planning; generated functions do not inspect
the environment. Tests supply synthetic fingerprints and do not depend on the
engine running the test suite.

AOT target resolution never reads `process.versions`. An exact Node major or a
bounded range can be declared in `jit.config.ts`; missing, unbounded, malformed
or unsupported ranges resolve to portable behavior. A range uses the strictest
policy among its known profiles so it cannot select a candidate that a member
profile rejects.

## Performance profiles

The checked-in target performance profiles are `jit-portable@1`,
`jit-node-22@1`, `jit-node-24@1`, and `jit-node-26@1`. Their admitted evidence
sets are currently empty because this change does not contain reviewed,
repeatable measurements for the supported engine lines. Optimized candidates
therefore remain visible in `PhysicalPlan.considered` with
`insufficient-evidence`; semantic baselines are selected by default.

Each evidence ID admitted later must resolve to a reviewed measurement record,
not merely to a hypothesis in `perf/assumptions/index.ts`. Changing a profile's
evidence list changes its digest, physical plan identity, and cache key. No
command that runs benchmarks mutates a profile.

Reports under `perf/results/` and proposed baselines under `perf/baselines/`
are separate from the compiler profile. To propose a profile change:

1. run the named scenario on each supported engine line;
2. compare repeated isolated-process results with the handwritten ceiling;
3. review the correctness and runtime/AOT differential coverage for the family;
4. update the performance profile and its version in a source change;
5. keep the report and evidence reference available with that review.

`pnpm perf:profile:propose` summarizes the fixed-array scenario matrix into an
ignored JSON proposal under `perf/results/`. It reports the old and suggested
threshold, sample confidence, evidence reference and affected operations. It
never edits the compiler profile.

One benchmark run is never sufficient to change compiler behavior. The target
policy and profile evidence remain immutable during compilation.
