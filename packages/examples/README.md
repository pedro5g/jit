# JIT Executable Examples

This workspace package is an integration fixture and a learning resource. It
runs the same user catalog in two execution modes and keeps the generated AOT
source in Git so compiler output is reviewable.

## Runtime JIT

```sh
pnpm --filter @jit/examples run runtime
```

[`runtime/index.ts`](runtime/index.ts) compiles operations on first use and
exercises:

- schema inference, selective validation, parse, safeParse, and issues;
- equal, clone, diff, hash, immutable parameterized update, mask, sanitize,
  mapper, JSON stringify/parse, and chunked JSON;
- eager query, lazy iterator, and direct visitor;
- progressive JSON validation across deliberately fragmented chunks;
- columnar binary rowsets and a fused binary `process()` aggregate;
- versioned binary codec over a real loopback TCP socket with length framing.

## Generated AOT

```sh
pnpm --filter @jit/examples run generate
pnpm --filter @jit/examples run compiled
```

[`compiled/catalog.jit.ts`](compiled/catalog.jit.ts) is the declaration file.
The CLI discovers only its explicit exports and writes
[`compiled/generated/index.mjs`](compiled/generated/index.mjs), CommonJS,
declarations, a manifest, subpath modules, and an operation plan.

The generated application imports validation, equal, clone, diff, hash,
masking, sanitization, JSON, binary codec, eager query, lazy iterator, visitor,
and mapper functions from that output. Its TCP round trip uses the generated
codec and imports no JIT runtime or compiler.

Progressive stream state and binary rowset allocation remain runtime ingestion
concerns, so those two lifecycle-oriented examples live in the runtime mode.
Their specialized query/validation/codec counterparts are still represented in
the AOT output. This distinction is intentional and prevents the example from
hiding a runtime dependency behind generated code.

## Verification

```sh
pnpm --filter @jit/examples run generate
pnpm --filter @jit/examples run typecheck
pnpm --filter @jit/examples run test
```

The tests execute both modes, open and close real ephemeral TCP servers, verify
observable parity, and assert that generated JavaScript contains no import from
`@jit/compiler`.

Generated files are committed on purpose. When a compiler change modifies
them, the diff is a source-level review of exactly what an application would
ship.
