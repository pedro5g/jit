# JIT Artifact WASM

Browser-safe bindings for the versioned `jit1_` artifact protocol.

```bash
pnpm artifact:wasm
```

The generated web module is committed under
`apps/site/lib/lab/generated`. It exposes two operations:

- `pack_typescript(files, outputRoot)` canonicalizes exact source files and
  returns a token plus verified metadata.
- `inspect_token(token)` performs complete bounded decoding and digest
  verification.

This package intentionally has no filesystem, process, network, command,
callback, trust-store or signing interface. Browser tokens provide BLAKE3
integrity, not publisher authentication. Private signing keys belong only in a
controlled server or native boundary.
