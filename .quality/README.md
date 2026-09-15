# JIT Quality System

The `.quality` directory contains versioned quality policy state and ignored derived reports.

## Commands

- `pnpm quality:context <path>` explains the layer, impacted gates, related fluent contracts, tests and baseline debt.
- `pnpm quality:block` is the required gate for the current change block.
- `pnpm quality:changed` evaluates changed files and their related coverage and code generation checks.
- `pnpm quality:full` evaluates the repository-wide quality tier.
- `pnpm quality:baseline:check` proves that an existing metric did not increase compared with the committed baseline.
- `pnpm quality:baseline:update` only lowers existing metrics or records newly created files; it cannot raise a prior value.

Reports are generated under `.quality/reports/` and are not committed. The baseline is committed and must not be weakened to accept a feature.

## Findings

Every gate emits deterministic `QG-*` findings. Use `pnpm quality:explain <code>` for the remediation of a known finding. Findings are ordered by gate, path, line, column, code and message.

Hard correctness findings are never baseline entries. Existing quantitative debt can be reported as a warning, but a changed metric may not move backwards.

## Fluent API grammar

The AST inventory discovers fluent operations from the real TypeScript surface. Each discovered operation must have a semantic contract declaring requirements, provided capabilities, repeat behavior, exclusivity, terminal behavior and fusion. The grammar is tooling metadata and does not ship in runtime or AOT output.

`forbid` rejects repeated singleton transitions, `accumulate` preserves independent stages, `idempotent` permits normalized repetition, and `explicit-replace` requires a declared replacement path. Runtime and type-level restrictions are tested separately where the public API supports both.

The API challenge gate asks the questions an implementation agent must answer before extending a chain: does the operation repeat, what does it combine with, is another name the same semantic intent, does an exclusive policy conflict, is a prerequisite missing, is the chain terminal, and is a composition genuinely fused? Inspect `.quality/reports/api-challenges.json` for the complete deterministic matrix. `verified` means the grammar agrees with a reviewed contract; `blocked` is an error; `needs-design` is an explicit warning that still requires an API decision and type/runtime proof.

## Adding a public fluent operation

1. Implement the operation and its runtime/type behavior.
2. Let the inventory discover it.
3. Add its semantic contract.
4. Add a focused runtime/type or generated transition test.
5. Add useful JSDoc and public documentation when the operation is user-facing.
6. Run `pnpm quality:context <path>` and finish with `pnpm quality:block`.

## Adding an emitter

Add deterministic source coverage, syntax validation, hostile-input coverage, differential behavior when a reference exists, and runtime/AOT parity coverage. Reuse the existing compiler audit and external bindings; do not interpolate runtime values into generated source.

## Adding a test

State the behavior or compatibility contract it protects. Prefer a table-driven test for data variants. A test that only executes a line without asserting a meaningful regression is not sufficient.

## Legitimate exceptions

Exceptions must be narrow, explain the architectural or generated-code constraint, and be encoded in the owning gate/configuration. Do not add a blanket ignore, raise a threshold, or weaken severity to make a change pass.
