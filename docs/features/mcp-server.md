# MCP Server

`@jit/compiler` includes `jit-mcp`, a local Model Context Protocol server for
coding agents working in a JIT project. It exposes the same declaration
discovery and AOT generator used by the CLI, plus project documentation,
diagnostics, prompts, and safe generated-source previews.

The server uses the MCP `2025-11-25` stdio transport: one UTF-8 JSON-RPC
message per line on stdin/stdout. Logs use stderr, so they never corrupt the
protocol stream. It has no MCP SDK dependency; applications that install JIT
for schemas or generated code do not add an agent framework to their runtime
graph.

## Configure A Client

Install JIT in the project, then configure the client to start the package
binary from the project root:

```json
{
  "mcpServers": {
    "jit": {
      "command": "pnpm",
      "args": ["exec", "jit-mcp"]
    }
  }
}
```

When a host cannot set the process working directory, pin the workspace with
an environment variable:

```json
{
  "mcpServers": {
    "jit": {
      "command": "pnpm",
      "args": ["exec", "jit-mcp"],
      "env": {
        "JIT_MCP_ROOT": "/absolute/path/to/project"
      }
    }
  }
}
```

Use one server process per workspace. The process keeps stdout protocol-only
and exits when the client closes stdin.

## Capabilities

The initialization response advertises only implemented capabilities:

- `tools`: project, documentation, diagnostics, inspection, preview, and
  generation;
- `resources`: project files, dynamic AOT inventory, and URI templates;
- `prompts`: schema design, AOT workflow, and performance review;
- `completions`: constrained values for prompt arguments and documentation
  paths;
- `logging`: accepts the standard client log-level request.

The server does not advertise resource subscriptions or list-change
notifications because local files are read on demand. It does not expose an
HTTP listener, sampling, elicitation, or experimental MCP tasks.

## Tools

Every successful tool call returns both a human-readable text block and
`structuredContent`. Tools declare an `outputSchema` and MCP annotations so a
client can distinguish read-only calls from writes.

| Tool                  | Mutates files | Purpose                                                       |
| --------------------- | ------------- | ------------------------------------------------------------- |
| `jit_project_context` | No            | Package, Git, pnpm commands, architecture/status excerpts     |
| `jit_project_doctor`  | No            | Node, config, declarations, explicit exports, output settings |
| `jit_docs_search`     | No            | Markdown search with file and line results                    |
| `jit_aot_inspect`     | No            | Grouped/standalone exports, operations, source files, output  |
| `jit_aot_preview`     | No            | Temporary build of source, types, manifest, or operation plan |
| `jit_aot_generate`    | Yes           | Writes the configured import-free generated package           |

### Recommended AOT Sequence

1. Call `jit_project_doctor` to catch missing config, declarations, or exports.
2. Call `jit_aot_inspect` to verify that every output is explicitly selected.
3. Call `jit_aot_preview` with `stage: "source"` and
   `stage: "declaration"` to review runtime code and types.
4. Preview `manifest` or a named `plan` when those artifacts are enabled.
5. Call `jit_aot_generate` only after review, with `{ "write": true }`.
6. Run the project's tests and bundle/tree-shaking checks.

`jit_aot_preview` uses a temporary directory and removes it after the result is
captured. It can honor output options without touching the configured output.
`jit_aot_generate` refuses to run unless `write` is literally `true`; an agent
cannot turn an inspection request into a write by omitting a default.

```json
{
  "name": "jit_aot_preview",
  "arguments": {
    "stage": "plan",
    "target": "User_is",
    "emit": { "plans": true }
  }
}
```

```json
{
  "name": "jit_aot_generate",
  "arguments": {
    "write": true,
    "emit": {
      "subpathModules": true,
      "manifest": true,
      "plans": true
    }
  }
}
```

Config remains the source of defaults. Tool arguments may override `files`,
`patterns`, `outDir`, `packageName`, `clean`, `emitPackageJson`, and individual
`emit` flags for one call.

## Resources

Fixed resources are listed only when their backing file exists:

- `jit://project/context`
- `jit://project/readme`
- `jit://project/package-guide`
- `jit://project/architecture`
- `jit://project/status`
- `jit://aot/config`
- `jit://aot/inventory`

Two templates provide targeted reads:

- `jit://docs/{path}` reads Markdown below `docs/`;
- `jit://generated/{path}` reads source, declarations, manifests, and plans
  below the resolved AOT output directory.

Resources are capped at 512 KiB per read. This keeps accidental generated
megafiles from consuming an agent's full context window; use AOT inspection or
a local file tool for larger artifacts.

## Prompts

`jit_schema_design` asks for a goal and optional `runtime`, `aot`, or `hybrid`
mode. It steers the agent toward typed schemas, selective compilation, runtime
tests, and inference tests.

`jit_aot_workflow` establishes the read-only doctor/inspect/preview sequence
before a write. `jit_performance_review` separates compilation from hot
execution and asks for representative cardinality, allocation, cache, source,
and benchmark evidence.

Prompts do not execute tools themselves. They provide a consistent workflow
that MCP clients can present to users and models.

## Workspace Security

The process startup directory, or `JIT_MCP_ROOT`, is the security boundary.
Every `root`, declaration file, output path, docs URI, and generated URI is
resolved and checked against that boundary. Existing symlinks are canonicalized
and checked again, preventing a link inside the project from exposing or
overwriting an outside path.

Only `jit_aot_generate` writes files. Its MCP annotations mark it as mutating,
destructive (because configured generated files may be replaced), and
idempotent. JIT's generator cleans only known generated artifacts, but clients
should still request user approval according to their own MCP tool policy.

AOT declaration modules are executable project code. Inspect, preview, doctor,
and generate load those modules in the local Node process, exactly as the CLI
does. Do not run the MCP server against an untrusted checkout.

## Protocol Errors

The stdio server distinguishes protocol and tool failures:

- malformed JSON returns JSON-RPC `-32700`;
- invalid requests/params return `-32600` / `-32602`;
- unknown methods return `-32601`;
- missing or denied resources return `-32002`;
- expected tool execution failures return `isError: true` with structured
  error content, allowing the model to correct config or arguments.

List methods currently fit in one page. Supplying a stale cursor returns
`-32602` instead of silently repeating results.

## Testing The Installed Server

The release smoke test packs the actual npm tarball, installs it into an empty
project, starts `node_modules/@jit/compiler/mcp.js`, sends an MCP initialize
request over stdin, and verifies tools/resources/prompts capabilities. Unit
tests additionally cover resources, templates, prompts, completions, preview,
generation, JSON-RPC errors, and path traversal.

For a manual protocol check:

```sh
printf '%s\n' \
  '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-11-25","capabilities":{},"clientInfo":{"name":"manual","version":"1"}}}' \
  | pnpm exec jit-mcp
```
