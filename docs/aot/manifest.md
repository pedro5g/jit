# Artifact Manifest v1

An artifact manifest is compact metadata for agents, tooling and integrity
checks. It is emitted as `jit.manifest.json` when requested and is paired with
`jit.receipt.json`.

## Shape

The top-level contract is:

```ts
interface ArtifactManifestV1 {
  manifestVersion: 1;
  compiler: { name: string; version: string };
  declarationDigest: string;
  programDigest: string;
  artifactDigest: string;
  manifestDigest: string;
  ownership: "managed" | "detached";
  emission: { format: "ts" | "js"; naming: "compact" | "semantic" };
  files: ManifestFile[];
  symbols: ManifestSymbol[];
  types: ManifestType[];
  protocols: ManifestProtocol[];
  semanticMap: SemanticMap;
}
```

Files contain path, byte count, SHA-256, exports and graph dependencies.
Symbols contain the name, kind, file/export, input/output, errors, capabilities,
protocols, dependencies and effects. The manifest intentionally excludes
implementation bodies, generated AST and private compiler nodes.

## Integrity

`artifactDigest` hashes the canonical list of generated file paths, hashes and
byte counts. `manifestDigest` hashes the manifest with its own digest blanked.
The receipt repeats all four relevant digests and the counts. Status inspection
re-hashes every declared file and verifies both sidecars without importing the
generated module.

```ts
const status = inspectArtifactStatus("src/generated");
// clean | modified | missing | stale | detached
```

Only `clean` managed output permits an agent to answer implementation questions
from metadata alone. A detached tree is not considered clean: its source is the
authority.

## Agent queries

The derived index supports deterministic lookups:

- declaration to generated symbols;
- symbol to file/export and reverse declaration;
- capability or protocol to symbols;
- symbol dependencies and consumers;
- type users and semantic changes between manifests.

These are exact indexes, not embeddings. `jit_source_read` is separate and
opt-in for debugging, review and drift investigation.

## Emission and ownership

The low-level generator keeps sidecars opt-in for compatibility. A managed
project should enable `emitManifest` and keep the sidecars with the generated
tree. Detached handoff is explicit and may retain the manifest only as transfer
metadata. A regeneration must never silently overwrite modified managed files.

An `ArtifactBundle` carries the same two sidecars as ordinary bundle entries:
`jit.manifest.json` and `jit.receipt.json`. The `jit1_` byte envelope and the
signed `jlr1_` registry record therefore authenticate source files and metadata
together; a transport does not need to rediscover metadata after unpacking.
Browser/Lab compilation merges per-file contributions into one project
manifest before publishing the bundle.
