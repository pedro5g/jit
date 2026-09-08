# Internal Performance Lab

This directory is deliberately outside `packages/jit`, package entrypoints,
the AOT manifest, and the browser bundle. It is an investigation harness, not
public API. It records measurements; it does not select compiler strategies.

Run the focused lab with:

```bash
pnpm bench:internal:runtime-types
pnpm bench:internal:codegen
```

The report is written to the ignored `bench/results/internal/` directory. It
contains Node/V8/platform metadata, compile and cold-start timings, Mitata
warm timings, emitted-source bytes/hash, helper/branch/loop/binding counts,
and allocation data when Mitata exposes heap counters.

V8 diagnostics are opt-in and intentionally noisy:

```bash
node --trace-opt --trace-deopt --import tsx/esm --conditions @jit/source bench/internal/runtime-type-cold.ts
```

The repeatable wrapper is:

```bash
pnpm bench:internal:v8
```

It stores a compact summary and the raw trace under the ignored internal
results directory. The probe includes both a monomorphic call site and a
deliberately polymorphic Runtime Type call site so deoptimizations are
observable rather than silently assumed away.

Do not use V8 intrinsics in production or package tests. A diagnostic run is a
separate observation and must never be treated as a correctness gate by itself.
