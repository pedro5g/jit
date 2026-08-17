# Changelog

All notable changes to this project are documented here. The project follows
[Semantic Versioning](https://semver.org/) and publishes the same version to
npm and JSR.

## [Unreleased]

## [2.0.0] - 2026-08-16

### Added

- Compile recursive schemas into named functions instead of inlining them, in
  the validator and in every structural emitter: clone, equal, diff, update,
  serialize, mask, sanitize, and the binary codec. Mutual recursion and
  recursive JSON Schema documents compile, and a schema without a cycle still
  emits byte-identical source.
- Add `JIT.jsonSchema` as a two-way bridge. `to` targets draft-2020-12,
  draft-07, draft-04, and OpenAPI 3.0 through one capability descriptor per
  dialect, selects the described side with `io`, and reports unsupported types
  with the failing path. `from` builds a schema from a document, infers the
  type from an `as const` literal, resolves local `$ref`, breaks cycles with a
  lazy back-edge, and refuses external refs. AOT resolves the conversion at
  generation time, so a module carries the specialized functions and never the
  document.
- Implement Standard Schema on every compiled validation artifact through
  `~standard`, including pipelines that end in validation.
- Add `JIT.mock`, a seeded generator whose values satisfy the schema's own
  checks, and `.meta()` for documentation metadata.
- Add `JIT.ops` declarative value transformations, folded into the generated
  validator as one source expression, covering strings, numbers, dates, and
  the conversions between them. A chain always generates ahead of time, where
  a callback that closes over its scope cannot be serialized.
- Add composable execution artifacts and fuse execution pipelines: one lazy
  callable lowers JSON and binary sources, validation, query, map, transform,
  update, security, and sinks, and terminal batch map plus JSON encode skips
  the mapped output array.
- Add schema-directed JSON decoding and finalize the composable native JSON
  API.
- Emit self-contained TypeScript AOT artifacts, default CLI generation to
  typed source, and emit optimized AOT source as either JavaScript or
  TypeScript.
- Add deterministic artifact reconstruction to the CLI and reconstruction of
  signed AOT artifacts in the documentation-site Lab.
- Compare tuples, records, sets, and maps in `JIT.compare.equal`, which
  previously refused four container types every other structural emitter
  already handled.
- Accept more than two conditions in `q.and` and `q.or`.

### Changed

- Reach every capability through exactly one namespace: `JIT.validate.*`,
  `JIT.compare.*`, `JIT.security.*`, `JIT.json.*`, and `JIT.binary.*`.
- Replace `JIT.compile(schema, { ... })` with a plain object of artifacts, and
  let the AOT generator read a declaration file literally instead of requiring
  a marker call.
- Make query builders the query itself: call the builder, and reach the other
  backends through `.to.iterator`, `.to.asyncIterator`, and `.to.visitor`.
- Make `JIT.map` the mapper, with `.many` in both entrypoints and an
  `overrides` argument that exists only while a target field cannot be
  inferred; Map schemas moved to `JIT.mapSchema`.
- Move `validate.parseAsync` and `validate.safeParseAsync` under
  `validate.async.parse` and `validate.async.safeParse`.
- Simplify AOT configuration to `entries`, `patterns`, and
  `output.{directory,format,perFile}`, let a schema name its generated type,
  keep an artifact's binding name, lower an object of artifacts into one
  frozen object, make export optional, and share one emission path between
  standalone and grouped artifacts.
- Identify generated output by banner during `clean`, never by name.
- Flatten object intersections at compile time, so update and serialize accept
  them, clone emits a single literal instead of one object per option plus an
  `Object.assign` result, and equal stops comparing a shared key twice.
- Lead `safeParse` with the allocation-free `is` check wherever the schema
  cannot rebuild its input, roughly 18% faster on valid values, in generated
  modules and in the runtime compiler alike.
- Keep only the four optimizer passes that demonstrably rewrite emitted
  source. Codegen over 2000 distinct schemas drops from ~328 ms to ~280 ms
  with byte-identical output, passes now descend into `for...of` bodies, and a
  test asserts every remaining pass still rewrites some real schema.
- Cache the cycle set per schema, so compiling a whole namespace for one
  schema costs a single graph traversal.
- Rebuild the documentation-site Lab as a responsive workspace and publish a
  complete public API reference whose coverage is enforced by the site tests.

### Removed

- Remove the legacy `validator`, `serializer`, `model`, and `mapper` runtime
  facades. Capability artifacts are the only aggregation model.
- Remove the root aliases and the `JIT.compile*` low-level re-exports; the
  `Compiler` namespace of the package root keeps them.
- Remove query `.compile()`, `.compileIterator()`, and `.compileVisitor()`.
- Remove the legacy AOT configuration block, `packageName`, `clean`, and the
  `emit` block. Generation no longer emits a `package.json`, an exports map,
  or a `sideEffects` declaration.
- Remove the generated `UserStrict<T>` alias in favour of the source-side
  `JIT.Strict<typeof User, T>` helper.

### Fixed

- Report a key shared by two intersection options once in `diff`, and bind a
  repeated operand once instead of re-walking the property chain on every
  mention, worth ~12% on values that actually differ.
- Compare static numeric defaults by decimal digits, so `.max(65535)
.default(8080)` no longer exhausts the type checker with TS2589, and a
  non-literal or decimal bound resolves to unknown instead of rejecting a
  valid default.
- Register and generate a standalone `JIT.update()` artifact, which previously
  vanished from generated output without even a skip notice.
- Emit a recursive type by name in the AOT type emitter, which looped forever
  on a back-edge, and evaluate multi-declaration generated sources once
  instead of assuming one function expression per artifact.
- Bust the ESM cache in `loadModule`, so `--watch` sees edits.
- Serialize and normalize compiler callbacks, including method callbacks.
- Terminate deep recursion in `mock` with a value that still satisfies the
  schema instead of `null`, and shrink lists near the depth limit.
- Drop dead output stores in the parse emitter, cutting `safeParse` source by
  10% and `parse` source by 8% with identical behaviour.
- Apply the third filter in the flows benchmark, which `q.and` silently
  dropped.

## [1.0.4] - 2026-07-16

### Added

- Add source-compiled sanitization policies for plain text, escaped HTML, HTML
  allowlists, SQL identifiers, path segments, control characters,
  normalization, length limits, and custom replacement patterns.
- Add reactive immutable update stores with typed path subscriptions,
  selectors, batching, configurable scheduling, error handling, lazy diffs,
  and disposal.
- Add compiled DTO aggregates for inbound validation and outbound whitelist
  mapping, including fused collection mapping and explicit operation selection.
- Add runnable playground scenarios for sanitization, reactive updates, DTOs,
  lazy models, and entity/index/query-keyed collection strategies.

### Changed

- Let `JIT.model` select operations through `.get(...)` or an options object so
  runtime and AOT builds retain only the requested generated functions.
- Compile grouped model and DTO selections as typed, import-free AOT objects
  while keeping standalone declarations as standalone generated exports.

### Fixed

- Keep the MCP initialization handshake synchronized with the package version.
- Add explicit public DTO and sanitizer types required by JSR's fast type
  analysis, without enabling the slow-types publishing escape hatch.
- Refresh the tracked AOT example after the expanded sanitizer bindings.

## [1.0.3] - 2026-07-16

### Fixed

- Resolve the public runtime entrypoint directly from TypeScript source in the
  root Vitest project, so release verification succeeds in a clean checkout
  without relying on ignored build artifacts from an earlier local build.

## [1.0.2] - 2026-07-16

### Added

- Compile explicit mapper selections with `.get("map", "many")`, so runtime
  and AOT output include only the mapper operations an application uses.
- Expose specialized string-format compilation and omit parse-only formatting
  work from boolean `is` validators.
- Expand the playground with lazy generators, visitors, watched lists, binary
  rowsets, chunked JSON, and generated-source inspection.

### Changed

- Use `JIT.Typeof<typeof Schema>` as the public schema inference API throughout
  runtime types, generated declarations, examples, and documentation.
- Simplify AOT configuration and align generated ESM, CJS, local-directory,
  package-directory, and declaration imports with the files actually emitted.
- Expand AOT, watched-list, cache, hash, entity, keyed-index, and tree-shaking
  documentation with production configuration and invalidation guidance.

### Fixed

- Resolve generated index imports to the configured JavaScript extension
  instead of referencing a missing `index.js` beside `.mjs` or `.cjs` output.
- Emit static object keys for compiled `keyof()` schemas and keep unrelated
  format transformations out of `is`-only generated functions.
- Correct responsive Get Started controls and reference-table alignment on the
  documentation site.

## [1.0.1] - 2026-07-12

### Fixed

- Publish the npm distribution as `@jit-compiler/jit`, because the npm `@jit`
  scope belongs to another publisher; JSR remains `@jit/compiler`.
- Preserve the `jit` and `jit-mcp` executable shims when installing from npm.

## [1.0.0] - 2026-07-12

### Added

- Compiled validation, equality, cloning, diffing, hashing, updates, queries,
  mapping, serialization, codecs, streaming, and binary rowsets.
- Runtime JIT and import-free AOT generation with explicit operation selection.
- Typed schema builders, ISO and Temporal schemas, codecs, masks, refinements,
  object transforms, and Standard Schema compatibility.
- CLI, generated package support, documentation site, load tests, and
  comparative benchmarks.
- MCP stdio server with structured tools, resources, prompts, completions,
  workspace-confined AOT preview/generation, and installed-package smoke tests.

[Unreleased]: https://github.com/pedro5g/jit/compare/v2.0.0...HEAD
[2.0.0]: https://github.com/pedro5g/jit/compare/v1.0.4...v2.0.0
[1.0.4]: https://github.com/pedro5g/jit/compare/v1.0.3...v1.0.4
[1.0.3]: https://github.com/pedro5g/jit/compare/v1.0.2...v1.0.3
[1.0.2]: https://github.com/pedro5g/jit/compare/v1.0.1...v1.0.2
[1.0.1]: https://github.com/pedro5g/jit/compare/v1.0.0...v1.0.1
[1.0.0]: https://github.com/pedro5g/jit/releases/tag/v1.0.0
