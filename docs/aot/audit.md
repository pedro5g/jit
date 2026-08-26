# Dual JIT + AOT API Audit

Updated: 2026-08-26

The continuous public guarantee is specified in
[Runtime / Define / AOT API Parity](./api-parity.md). This document remains the
implementation audit: it records what backs that contract and the known
migration gaps. The entrypoint parity matrix now checks namespace shape,
reconstructive metadata, non-executable define artifacts and runtime/AOT
semantic results through one reusable table.

This audit compares the master dual JIT + AOT plan with the current
single-package implementation. npm publishes it as `@jit-compiler/jit`, while
JSR keeps `@jit/compiler`. The npm package exposes transitional subpaths that
map to the planned split:

- `@jit-compiler/jit/runtime` maps to the planned runtime host entrypoint.
- `@jit-compiler/jit/define` maps to the planned AOT definition host entrypoint.
- `@jit-compiler/jit` keeps the compatibility root namespace.

## API Alignment

Implemented and covered by tests:

- `JIT.Typeof<typeof Schema>` is the single public helper for resolving a schema output type.
- `JIT.validate.is/parse/safeParse(schema)` and `JIT.validate.async.parse/safeParse(schema)`.
- `JIT.equal/diff/hash(schema)` and `JIT.clone(schema)`.
- `JIT.json.stringify(schema)`.
- `JIT.json.parse(schema).validate()` as AOT `fromJSON`.
- `JIT.update(schema).patch({ field: JIT.param("name") }).compile()`.
- `JIT.cqrs.query(schema).params({...}).where((q, params) => ...)`, with
  top-level `JIT.query(collection)` retained for compatibility.
- `JIT.const(value)` and `q.constant(value)` for build-time query literals.
- `JIT.transform(schema).select(...).map(...)` for built-in field
  transforms such as `lowercase`, `uppercase`, and `trim`.
- `@jit-compiler/jit/define` AOT stubs throw if executed and register artifact metadata for
  `jit generate`.
- `jit init`, `jit doctor`, `jit list`, `jit inspect`, `jit clean`, and
  `jit generate`.
- Config exposes only discovery plus one output target: `entries`, `patterns`,
  `output.directory`, `output.format`, `output.perFile`.

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

These contracts are now public through `import { Host } from "@jit-compiler/jit"` and
type exports from the root package.

## AOT Generation

Currently implemented:

- a standalone artifact keeps the developer's exact binding name;
- an object of artifacts emits one frozen object with exactly those members;
- a schema emits a named exported type and no runtime function;
- `diff`, `stringify`, `fromJSON`, validators, equal, clone, hash, specialized
  string formatters, mask, sanitize, codec, queries, mappers, and
  built-in transforms are re-emitted from registered artifacts when
  serializable;
- generated JS has no `import "jit"` and is ready-to-run ESM;
- generated TypeScript contains the executable optimized functions plus their
  public types in one `.ts` source;
- output is exactly `index.ts` or `index.js`, imported relatively;
- `output.perFile` adds one independently compiled module per declaration
  file plus an `index` barrel that re-exports them;
- previous output is replaced by ownership (generated banner), never by name,
  so hand-written files in the same directory survive.

Still structural/future work from the plan:

- source maps and atomic directory swaps;
- generation worker isolation and incremental cache;
- complete artifact type metadata independent of source-file type imports;
- `jit check` and deeper stage inspection for logical/physical IR.

## Known Architectural Gap

The current monorepo still has schema builders coupled to builder runtime
conveniences, so importing `@jit-compiler/jit/define` is a host-compatible API step but not
yet the final physical package split where define imports zero compiler code.
The current `createJIT(host, namespace)` adapter exists to lock the contract;
the next migration should move schema builders into a compiler-free core
package, then collapse this into the final `createJIT(host)` shape.
