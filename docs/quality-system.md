# JIT Quality System

The quality system turns important engineering rules into deterministic gates. The intended development loop is:

```text
quality:context
    -> implement one block
    -> quality:block
    -> correct every error
    -> continue
```

## Gate tiers

Tier A is immediate feedback: formatting, lint, TypeScript integrity, architecture boundaries, structural deltas, comment policy and public API documentation. Tier B covers changed tests, coverage, duplication, code generation and API grammar. Tier C covers repository-wide reachability, mutation testing and full audits.

`quality:full` orchestrates the repository-wide path. Existing project commands remain authoritative; the quality CLI centralizes their results and adds normalized findings.

## Finding and baseline policy

Findings use stable `QG-*` codes and deterministic ordering. Correctness issues such as invalid generated source, unsafe interpolation, an unregistered fluent operation, a new forbidden import, a setup file containing tests, or a runtime/type contradiction are not baselineable.

The quantitative baseline records existing file metrics. Its ratchet is monotonic: an existing metric may stay equal or decrease, never increase. `quality:baseline:init` is a one-time capture after hard findings are corrected. `quality:baseline:update` may remove debt or record a new file, but it cannot justify a regression.

## Architecture and structure

The import graph is resolved with the TypeScript Compiler API. Layer boundaries are declared in `quality.config.ts`, while type-only edges are kept distinct from runtime dependencies. Cycles, package-root imports from internal source and forbidden new layer edges are reported with locations and remediation.

Structural metrics include logical lines, exports, imports, fan-out, functions, largest function, cyclomatic complexity and nesting. God-module detection combines these signals and is a watch/legacy indicator rather than a claim of mathematical SOLID proof. Existing oversized modules are debt; they cannot grow.

## Tests and coverage

Vitest setup is audited so setup files cannot contain test declarations. Test findings include duplicate titles, exact duplicate bodies and changed test files without meaningful assertions. V8 coverage is emitted as JSON, JSON summary and text. Changed executable lines are mapped from `git diff` to the coverage map. Coverage is ratcheted by file and by metric rather than only by a global percentage.

Mutation modes are configured for changed, critical and full scopes. Mutation runs are deliberately not placed in the fast commit path; the critical/full quality tier can request them explicitly with `QUALITY_RUN_MUTATION=1`.

## Code generation

The codegen gate reuses the existing generated-source tests and adds static checks for unsafe or shape-agnostic emission. The required pipeline is deterministic emission, syntax validation, repeated emission equality, safety audit, execution, reference differential behavior and runtime/AOT parity. Runtime values remain external bindings and never become untrusted source text.

## API coherence

The fluent API is treated as a language. The AST inventory discovers the actual operation surface, and a semantic contract describes its state transition. The grammar can reject repeated singleton stages, exclusive conflicts, missing prerequisites and terminal continuation. Parse/decode stages expose the shared `parse-stage` capability so validation can fuse into the same pipeline.

For the builder surface, singleton email validation is rejected in the runtime builder and excluded from the subsequent TypeScript chain. Independent refinements remain cumulative. Quality metadata stays under `tools/quality` and is not emitted into runtime or AOT artifacts.

The API challenge gate turns unresolved semantics into explicit questions instead of silently accepting every chain. It writes `.quality/reports/api-challenges.json` and checks repeat, exclusive, prerequisite, terminal, fusion, alias and representative combination transitions. A challenge has one of three statuses:

- `verified`: the declared contract and grammar agree;
- `blocked`: the grammar contradicts a reviewed contract and the block fails;
- `needs-design`: the operation is inferred or the combination requires an explicit product decision.

For example, `email -> email` is expected to be invalid and is a verified challenge. `min -> gte` is flagged as a semantic alias decision: the owner must decide whether it accumulates, is redundant, or needs an explicit replacement. A warning is not permission to ignore the question; it is the audit queue for legacy operations whose semantic policy has not yet been reviewed. New operations must not remain inferred.

The challenge question is deliberately repeated across the type and runtime boundaries: if a sequence is invalid, the TypeScript surface should stop offering it when possible, dynamic calls should fail deterministically, and supported runtime/AOT paths should preserve the same semantic result. The grammar is the source of truth for chaining; it does not add metadata to runtime or AOT bundles.

## Reports and agent workflow

Derived JSON reports belong under `.quality/reports/`. They are reproducible and ignored. A finding message includes the path, location, observed evidence and a concrete remediation. `pnpm quality:context <path>` is the starting point for an agent before a substantial edit; a block is not complete while `quality:block` has an error.
