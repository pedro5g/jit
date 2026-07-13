# Changelog

All notable changes to this project are documented here. The project follows
[Semantic Versioning](https://semver.org/) and publishes the same version to
npm and JSR.

## [Unreleased]

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

[Unreleased]: https://github.com/pedro5g/jit/compare/v1.0.1...HEAD
[1.0.1]: https://github.com/pedro5g/jit/compare/v1.0.0...v1.0.1
[1.0.0]: https://github.com/pedro5g/jit/releases/tag/v1.0.0
