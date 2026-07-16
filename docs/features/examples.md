# Executable Runtime And AOT Examples

The `packages/examples` workspace is both documentation and an integration
gate. It uses real schemas, generated code, fragmented JSON streams, binary
rowsets, and ephemeral TCP sockets. Nothing is pseudocode.

## Run The Examples

```sh
pnpm --filter @jit/examples run runtime
pnpm --filter @jit/examples run generate
pnpm --filter @jit/examples run compiled
pnpm --filter @jit/examples run test
```

The runtime and AOT commands print a deterministic JSON summary. The tests
assert validation failures, query results, cloning behavior, diff paths,
stable hashes, binary sizes, streamed item counts, rowset aggregates, and the
socket round trip.

## Coverage Matrix

| Capability                  | Runtime JIT | Generated AOT | Notes                                                       |
| --------------------------- | ----------- | ------------- | ----------------------------------------------------------- |
| Schema inference            | Yes         | Yes           | Generated declarations anchor types on `catalog.jit.ts`     |
| `is`, `parse`, `safeParse`  | Yes         | Yes           | AOT emits one specialized validator scope                   |
| Equal, clone, diff, hash    | Yes         | Yes           | No reflective object traversal at execution time            |
| Update                      | Yes         | No            | Parameterized update is currently a runtime-only artifact   |
| Mask and sanitize           | Yes         | Yes           | Only annotated paths are rebuilt                            |
| Mapper                      | Yes         | Yes           | The generated mapper contains only target fields            |
| Eager query                 | Yes         | Yes           | Filters and projections are fused                           |
| Lazy iterator and visitor   | Yes         | Yes           | AOT emits generator and visitor implementations             |
| JSON stringify/parse        | Yes         | Yes           | Keys and validation are specialized                         |
| Chunked JSON                | Yes         | No            | Chunk lifecycle remains a runtime boundary                  |
| Progressive stream          | Yes         | No            | Scanner state belongs to the live ingestion boundary        |
| Binary codec                | Yes         | Yes           | The same generated codec crosses the TCP example            |
| Binary rowset and `process` | Yes         | Query only    | Allocation/loading is runtime; byte query source can be AOT |
| TCP socket framing          | Yes         | Yes           | Uses real loopback sockets and a four-byte length prefix    |

The distinction matters. AOT should remove schema traversal and compiler code,
but it should not pretend that lifecycle state disappears. Network scanners
need live chunk state, and binary rowsets need memory owned by an ingestion
boundary. The example keeps those concerns explicit.

## Generated Files

`compiled/catalog.jit.ts` exports only selected operations. Running
`jit generate` creates and commits:

```text
compiled/generated/
├── index.js
├── index.d.ts
├── catalog.js
├── catalog.d.ts
├── manifest.json
└── plans/catalog.json
```

The JavaScript has zero imports from `@jit-compiler/jit`. The compiled example
uses a normal relative `./generated/index.js` import, and TypeScript resolves
the adjacent generated declaration without a package alias.

Generated files are committed intentionally. `pnpm examples:check` regenerates
them and rejects a diff, which catches stale snapshots, nondeterministic code,
absolute machine paths, changed tree-shaking surfaces, and declaration drift.

## Socket Strategy

TCP is a byte stream and does not preserve message boundaries. The shared
socket helper prefixes each binary codec payload with a four-byte big-endian
length. The server waits for a complete frame, decodes and re-encodes it with
the selected runtime or generated codec, and closes cleanly after returning one
frame.

This demonstrates the intended separation:

1. the application owns framing, backpressure, retries, and connection state;
2. the JIT codec owns schema-specific bytes and version validation;
3. the validator owns application-level correctness after decoding.
