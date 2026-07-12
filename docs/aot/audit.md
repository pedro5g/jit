# Dual JIT + AOT API Audit

Updated: 2026-07-11

This audit compares the master dual JIT + AOT plan with the current
single-package implementation. The package is published as `@jit/compiler`, with transitional
subpaths that map to the planned split:

- `@jit/compiler/runtime` maps to the planned runtime host entrypoint.
- `@jit/compiler/define` maps to the planned AOT definition host entrypoint.
- `@jit/compiler` keeps the compatibility root namespace.

## API Alignment

Implemented and covered by tests:

- `JIT.Infer<typeof Schema>` and legacy `JIT.infer<typeof Schema>`.
- `JIT.validate(schema).is/parse/safeParse/parseAsync/safeParseAsync().compile()`.
- `JIT.equal/clone/diff/hash(schema).compile()`.
- `JIT.json(schema).stringify().compile()`.
- `JIT.json(schema).parse().compile()` as AOT `fromJSON`.
- `JIT.update(schema).patch({ field: JIT.param("name") }).compile()`.
- `JIT.query(schema).params({...}).filter((q, params) => ...).compile()`.
- `JIT.const(value)` and `q.constant(value)` for build-time query literals.
- `JIT.transform(schema).select(...).map(...).compile()` for built-in field
  transforms such as `lowercase`, `uppercase`, and `trim`.
- `@jit/compiler/define` AOT stubs throw if executed and register artifact metadata for
  `jit generate`.
- `jit init`, `jit doctor`, `jit explain`, `jit list`, `jit inspect`,
  `jit clean`, and `jit generate`.
- Config accepts the plan-shaped `entries` + `output` block, while legacy
  `schemas`/`outDir` remains readable.

## Schema Operator Alignment

The schema operators requested in the finalization MD are present in the
runtime builder surface and compile through the validator/codegen path:

- conditional refinement and fields: `.refine(..., { when, path })`,
  `.where(...)`, `.when(...)`;
- object shape operators: `.pick(...)`, `.omit(...)`, `.partial(...)`,
  `.required(...)`, `.strict()`, `.loose()`, `.catchall()`, `.keyof()`;
- logical operators: `.or(...)`, `.and(...)`, `.xor(...)`, `.not()`;
- string/format operators: `.oneOf(...)`, `.noEmpty()`, `.startsWith()`,
  `.endsWith()`, `.includes()`, `.normalize()`, `.toLowerCase()`,
  `.toUpperCase()`, `.httpUrl()`, `.jwt()`, `.stringFormat(name, regex)`,
  masks (`.format`, `.cpf`, `.cnpj`, `.phoneBR`) and ISO date/time formats;
- numeric operators: `.moreThan()`, `.lessThan()`, `.gt()`, `.gte()`,
  `.lt()`, `.lte()`, `.nonnegative()`, `.nonpositive()`, `.step()`,
  `.oneOf()`, `.int32()`, `.float32()`, `.float64()`;
- Date and Temporal checks: `.min()`, `.max()`, `.between()`,
  `.daysOfWeek()`, `.monthsOfYear()`, `.truncateTo()`;
- special schemas: `JIT.templateLiteral`, `JIT.json`, `JIT.function`,
  `JIT.custom`, `.apply`, and value `JIT.codec`.

Compiled structural operations now share the same static-default semantics:
`equal`, `hash`, `clone`, `diff`, `update`, and `stringify` canonicalize
static `.default(value)` properties. Optional fields stay optional, and
union/discriminated-union branches are handled by branch-aware generated code
instead of generic schema interpretation.

## Shared Contracts

Implemented in `packages/jit/src/core/host.ts`:

- `CompilerHost`
- `CompilationRequest`
- `CompilationOptions`
- `OperationDescriptor`
- `CompiledArtifact`
- `ArtifactDescriptor`
- `SchemaMetadata`
- `AOTArtifact`
- `AOT_ARTIFACT`
- `SCHEMA_METADATA`
- `createJIT(host, namespace)` transitional adapter

These contracts are now public through `import { Host } from "@jit/compiler"` and
type exports from the root package.

## AOT Generation

Currently implemented:

- standalone compiled exports keep the developer's exact export name;
- grouped `JIT.compile(schema, { ... })` emits only the grouped object;
- raw schemas and array-style compile markers are skipped;
- `diff`, `stringify`, `fromJSON`, validators, equal, clone, hash, mask,
  sanitize, codec, query extras, mapper extras, and built-in transform extras
  are re-emitted from registered artifacts when serializable;
- generated JS has no `import "jit"`;
- generated `.d.ts` anchors types to the user's schema file when source
  metadata is available.
- optional subpath entrypoints such as `user.mjs`/`user.d.ts` for
  `#jit/user`-style imports;
- optional deterministic `manifest.json` and `plans/*.json` review artifacts.

Still structural/future work from the plan:

- fully independent package-per-module output (`user.js`,
  `queries/admins.js`) rather than today's thin subpath re-export modules;
- source maps and atomic directory swaps;
- generation worker isolation and incremental cache;
- full Declaration IR independent of source-file type imports;
- `jit check` and deeper stage inspection for logical/physical IR.

## Known Architectural Gap

The current monorepo still has schema builders coupled to builder runtime
conveniences, so importing `@jit/compiler/define` is a host-compatible API step but not
yet the final physical package split where define imports zero compiler code.
The current `createJIT(host, namespace)` adapter exists to lock the contract;
the next migration should move schema builders into a compiler-free core
package, then collapse this into the final `createJIT(host)` shape.
