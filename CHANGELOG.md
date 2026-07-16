# Changelog

All notable changes to this project are documented here. The project follows
[Semantic Versioning](https://semver.org/) and publishes the same version to
npm and JSR.

## [Unreleased]

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

[Unreleased]: https://github.com/pedro5g/jit/compare/v1.0.3...HEAD
[1.0.3]: https://github.com/pedro5g/jit/compare/v1.0.2...v1.0.3
[1.0.2]: https://github.com/pedro5g/jit/compare/v1.0.1...v1.0.2
[1.0.1]: https://github.com/pedro5g/jit/compare/v1.0.0...v1.0.1
[1.0.0]: https://github.com/pedro5g/jit/releases/tag/v1.0.0
