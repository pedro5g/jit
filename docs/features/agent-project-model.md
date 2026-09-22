# Agent project model

## Problem

An agent that reads generated source to answer “how do I create `User`?” pays
tokens for implementation details that the compiler already knows. It also
races with regeneration: a stale file can make a correct manifest describe the
wrong bytes.

The project model gives the agent a revisioned declaration surface and exact
artifact queries. Normal semantic work does not include generated source in the
prompt.

## Declaration protocol

`DeclarationProjectV1` is structured data for declarations, modules and
configuration. Its schema forms map to the existing JIT builders and its
operations are validated before application:

```json
{
  "version": 1,
  "baseRevision": "R8",
  "operations": [
    {
      "op": "create",
      "name": "User",
      "declaration": {
        "kind": "schema",
        "schema": {
          "type": "object",
          "fields": {
            "name": { "type": "string", "checks": [{ "kind": "min", "value": 2 }] }
          }
        }
      }
    }
  ]
}
```

The fluent TypeScript API and this protocol lower to the same schema/semantic
model. The protocol does not expose ATS, `ExecutionPlan` or compiler IR.

## Revisioned edits

Reads return a deterministic revision. Writes include `baseRevision`; a changed
project returns `REVISION_CONFLICT` and applies nothing. A successful patch
creates the next content-addressed revision. Supported primitives are create,
update, remove, rename, move and module creation/removal.

`jit_compile_plan` is read-only and reports affected declarations, modules,
symbols, expected writes, protocol changes and semantic contract changes. It is
the preview boundary before `jit_compile` materializes source and sidecars.

## Shared tools

The transport-independent `AgentToolCore` owns these contracts:

| Tool | Purpose |
| --- | --- |
| `jit_model_get` | Read one declaration or a filtered project scope |
| `jit_model_apply` | Validate and apply a revisioned patch |
| `jit_compile_plan` | Preview semantic and filesystem impact |
| `jit_compile` | Compile and return digests/counts, not source |
| `jit_artifact_status` | Verify managed file hashes and receipt |
| `jit_artifact_find` | Find a symbol by declaration/capability |
| `jit_artifact_describe` | Read a compact manifest contract |
| `jit_artifact_dependencies` | Read dependency/consumer relationships |
| `jit_source_read` | Explicit source retrieval for debugging only |

MCP, WebMCP and Lab adapters expose the same definitions. They do not duplicate
compiler semantics or turn an inspect call into a write.

## Runtime and AOT

Compilation reuses the existing builders and AOT generator. Runtime and AOT
therefore retain parity for validation, class construction and generated
contracts. Model files, manifests and receipts are tooling/build-time data; they
add no work to hot runtime operations.

## Measurement

The reproducible evaluation is `pnpm bench:agent`. It runs five golden
semantic tasks (find `User`, describe `parseUser`, inspect `UserId` consumers,
find the parse capability and verify status), validates every answer, and
compares a source-driven baseline with manifest mode. One run on the local
Node `v22.17.1` environment produced:

| mode | tool calls | source reads | source bytes | estimated input tokens | estimated output tokens |
| --- | ---: | ---: | ---: | ---: | ---: |
| source-driven | 10 | 5 | 26,220 | 6,914 | 7,097 |
| manifest-driven | 5 | 0 | 0 | 24 | 207 |

The byte/4 token estimate is deliberately simple and is not a model tokenizer.
For this fixture, the manifest path reduced the measured tool payload estimate
from 14,031 to 231 tokens (about 98.4%) and required no generated-source read.
Source retrieval remains available for exceptional debugging, but semantic
tools refuse to treat a modified or stale manifest as authoritative.

## Non-goals

The model is not a second compiler, a general patch language for arbitrary
source, an embeddings index, or an authorization policy. File edits outside the
declared model remain source work and must be treated as managed-artifact drift.
