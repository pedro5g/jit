# Sovereign artifacts and agent-native compilation

## Decision

JIT declarations are the source of intent. The compiler lowers them through
one semantic pipeline and may materialize the result in two hosts:

```text
declaration
  -> semantic model / ExecutionPlan
  -> optimized lowering
  -> ArtifactProgram
  -> module and name planning
  -> JavaScript or TypeScript
```

Runtime execution and AOT emission therefore share semantic plans. Runtime
materializes a callable in the current process; AOT materializes an ordinary
module tree. Generated code is a product, not a serialized compiler object.

## Terms

**JIT Declaration** is the public TypeScript or structured declaration that
describes a schema, type, capability or semantic operation.

**JIT Semantic Model** is the normalized schema and plan vocabulary used after
declaration validation. It contains no transport-specific agent commands.

**ArtifactProgram** is the source-independent final program after semantic
lowering and before source emission. It contains modules, declarations,
exports, symbol contracts and protocol bindings.

**Artifact Module Graph** is the deterministic graph of those modules. It owns
module dependencies, topological ordering, cycle detection and relative import
planning. Emitters do not discover imports by scanning their own output.

**Artifact Manifest** is a versioned, compact description of generated files,
exports, contracts, dependencies, protocols and declaration traceability. It
does not contain implementation bodies, compiler IR or a second copy of the
source.

**Compilation Receipt** binds declaration, program, manifest and artifact
digests to a compiler identity and a list of checks. It is verifiable metadata,
not a cryptographic proof of correctness.

**Managed Artifact** has `ownership: "managed"`. The declaration and compiler
remain authoritative; a file edit is drift and must be reported before a
regeneration can overwrite it.

**Detached Artifact** has `ownership: "detached"`. It is an explicit handoff:
the consumer owns the files and source is authoritative. The manifest remains
historical metadata and must not be used to describe current implementation.

**Agent Project Model** is the revisioned, structured representation used by
agent tools. It is a transport model that lowers into the same semantic model
as the fluent API; it is not a second schema engine.

**Protocol Capability** is an explicit semantic contract such as
`standard-schema/v1`, `standard-json-schema/v1` or `event-v1`. A capability is
attached only when the generated boundary implements that protocol.

## Trust and ownership

The manifest is authoritative for semantic answers only when a managed tree is
`clean`. Status is derived from the declared file hashes and the receipt:

```text
clean      -> manifest semantics may be trusted
modified   -> a declared file changed; inspect source or regenerate
missing    -> a declared file disappeared
stale      -> metadata or receipt no longer binds to the tree
detached   -> source is authoritative; manifest is historical
```

The integrity chain is:

```text
declaration digest -> program digest -> manifest digest -> file hashes
```

No agent-facing lookup may silently turn a non-clean manifest into a current
source claim.

## Boundary rules

- Generated JavaScript and TypeScript have no import from `@jit-compiler/*`.
- Public generated contracts are structural by default; `portableErrors: false`
  is a temporary compatibility escape hatch. Runtime-only error nominality is
  never an AOT ABI.
- Standard Schema is emitted only for a boundary whose input and output match
  the protocol. `is` and `safeParse` are not Standard Schema merely because
  they validate a value.
- The module graph is built from semantic dependencies before source emission.
- Agent, MCP, WebMCP and Lab adapters call shared tool contracts. They do not
  contain compiler business logic.
- Manifest sidecars and project revisions are build/tooling-time metadata and
  add no hot-path runtime work.
- Artifact transports preserve `jit.manifest.json` and `jit.receipt.json` as
  hash-bound bundle files. `jit1_` and signed `jlr1_` references authenticate
  the same source-plus-metadata tree.

## Compatibility and migration

The existing AOT marker, legacy runtime error names and transport commands are
kept while compatibility coverage is established. New artifact contracts are
introduced behind explicit metadata and are tested against both runtime and AOT
hosts. A migration is complete only when the generated tree, manifest and
receipt can be checked without loading the JIT runtime.
