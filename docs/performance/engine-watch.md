# Engine watch

Node 22, 24 and 26 are the current reviewed runtime lines. The scheduled
`engine-watch.yml` workflow compares a runtime fingerprint before starting the
measurement suite. An unchanged fingerprint can reuse its cached report; a new
fingerprint runs the assumptions, code-generation and critical suites and
uploads a machine-readable report.

Node nightly runs are non-blocking early warnings. They do not alter checked-in
profiles or baselines. A canary result needs repeated measurements and human
review before its evidence can become a compiler input.

The engine report compares the selected strategies under each checked-in
target profile. That output is deterministic policy output, not a benchmark;
the isolated performance reports contain actual measurements. When results
change, reproduce them with the exact Node executable and scenario recorded in
the report before proposing a profile update.

Performance findings remain distinct: a `PERF-REGRESSION` is a stable slowdown,
`PERF-UNSTABLE` is noisy data, `PERF-MODEL-DRIFT` is a repeated mismatch between
estimated and measured ranking, and `PERF-ENGINE-CHANGE` marks a fingerprint
change. None of these findings changes the compiler automatically.
