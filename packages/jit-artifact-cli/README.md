# JIT Artifact CLI

`jit-artifact` transports generated JIT files as deterministic, byte-exact
tokens. It performs no network requests, dependency installs, shell commands or
lifecycle hooks.

## Build

```bash
pnpm artifact:build
./target/release/jit-artifact --help
```

## Configure

```bash
jit-artifact init
```

```json
{
  "schemaVersion": 1,
  "outputRoot": "src/generated/jit",
  "compression": "auto",
  "profile": "balanced",
  "dictionary": true,
  "conflict": "abort"
}
```

Flags override the configuration file.

## Create And Apply

```bash
pnpm jit generate --output-format ts
jit-artifact pack generated/jit --output artifact.jit
jit-artifact inspect --file artifact.jit
jit-artifact diff --file artifact.jit --patch
jit-artifact apply --file artifact.jit
```

Use `--yes` only in automation. It skips the prompt but never skips token,
digest, decompression or path verification.

`conflict` supports:

- `abort`: default; existing output is untouched.
- `overwrite`: atomically replaces the complete generated tree.
- `backup`: replaces the tree and retains the previous directory for rollback.

```bash
jit-artifact transactions
jit-artifact rollback <transaction-id>
```

## Trust

A `jit1_` token is unsigned. BLAKE3 digests prove that reconstructed bytes
match the token, but do not prove who created it. The CLI reports
`publisher unauthenticated` instead of presenting integrity as identity.

Official signed capsules require a server/native signer. A private signing key
must never be included in the browser or WASM package.
