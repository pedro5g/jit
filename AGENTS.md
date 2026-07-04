# JIT Agent Guide

This repository contains **JIT**, a TypeScript library for describing data structures once and compiling specialized JavaScript operations over those structures.

Read [docs/architecture.md](docs/architecture.md) before substantial architecture or migration work. It contains the full project context, target architecture, migration plan, performance principles, and definition of done for the initial typed operator-chain work.

If `docs/internal/STATUS.md` exists, read it first — it is a local-only (gitignored) snapshot of current project state and pending work.

## Workflow

- Use `pnpm`.
- Do not use `npm`, `yarn`, or `bun` unless explicitly requested.
- Inspect the real implementation before changing code.
- Preserve legacy behavior until compatibility tests prove a replacement.
- The legacy `DSL` and `ATS` directories have been migrated to the namespace-based `JIT` factories/core and removed. Do not reintroduce them.
- Keep `equal` and `shared` compatibility code unless their replacements have compatibility coverage.
- Keep changes scoped to the current stage.
- Check the worktree before editing and do not revert unrelated user changes.

## Commands

Root scripts:

```bash
pnpm format:check
pnpm lint:check
pnpm test
pnpm build
```

Write commands:

```bash
pnpm format
pnpm lint
pnpm fix
```

Use write commands deliberately and inspect the resulting diff.

## Module Conventions

- The project is ESM.
- TypeScript source imports must use emitted JavaScript extensions when importing local modules:

```ts
import type { TypeSchema } from "./type-schema.js";
import { TypeName } from "./type-name.js";
```

- Use `import type` for type-only dependencies.
- Do not import from the package root inside the same package.
- Avoid making namespace barrels dependency-cycle hubs.

## Namespace Pattern

The project intentionally uses namespace-oriented exports:

```ts
export * as Equal from "./equals.js";
export * as Parse from "./parse.js";
export * as Utils from "./utils.js";
export type Equal<T = unknown> = import("./types.js").Equal<T>;
```

Preserve this style where it improves API navigation and compatibility. Runtime namespace exports and type aliases may share a public name.

## Callable Operators

Callable functions may have attached static operations when the property is a stable specialization of the same operation:

```ts
Equal.array(childEqual);
Equal.array.writable(childBuilder);
```

Prefer explicit callable interfaces for new code. Do not turn functions into arbitrary property containers.

## Schema Shape

The new AST must use a stable runtime shape:

```ts
{
  type,
  _type,
  def,
  annotations,
}
```

Rules:

- `_type` is a TypeScript phantom output type.
- `_type` must be `null` at runtime.
- Centralize the assertion that makes `_type` typed while storing `null`.
- Preserve property order: `type`, `_type`, `def`, `annotations`.
- Prefer stable definition shapes over conditionally added properties.

Legacy schemas may still use fields such as `item`, `props`, `schemas`, `literalValue`, and `enumObject`. Treat them as compatibility concerns during migration.

## Typing

- Avoid new `any`.
- Use `unknown`, precise generics, conditional types, mapped types, and discriminated unions.
- Public legacy aliases may keep old defaults such as `Equal<T = any>` when required for compatibility.
- Every new `any` must be a deliberate compatibility boundary, external-library boundary, or isolated implementation signature hidden behind precise public types.
- Use `// @ts-expect-error` for intentional invalid API tests. Do not use `@ts-ignore`.

## Builders And Transforms

- Keep schema AST separate from the fluent builder chain.
- Keep schema builders separate from compiler/code-generation builders.
- Do not use `Proxy`.
- Builder instances should have a small, stable shape, ideally `{ schema }`.
- Share methods through prototypes, classes, or another allocation-conscious mechanism.
- `partial`, `required`, `pick`, `omit`, `extend`, and `merge` are transforms over existing schemas, not new AST node types.
- Transform functions should be independent from builders.

## Tests

- Use Vitest.
- Colocate package tests under `__tests__` directories.
- Follow the style used by `packages/jit/src/factories/__tests__/factories.test.ts`: nested `describe` groups such as `primitives`, `collections`, `complex structures`, `literal`, `modifiers and chains`, and `object operators`; each test should pair runtime schema assertions with `expectTypeOf` inference assertions.
- Test both runtime behavior and type inference for typed APIs.
- Keep regression tests between legacy and new implementations during migration.
- Generated-source tests must verify deterministic source and behavior.

## Code Generation

- `new Function` belongs only in the compilation path.
- Never interpolate untrusted runtime values into generated source.
- Use external bindings for predicates, transforms, constructors, regular expressions, custom comparators, and unsafe literals.
- Centralize source helpers for identifier validation, string escaping, property access, literal emission, and binding allocation.
- Generated code should be readable, deterministic, and engine-friendly.

## Performance Principles

- Avoid work.
- Specialize when schema information is known.
- Preserve stable object shapes.
- Avoid unnecessary allocation and indirection.
- Avoid generic callbacks in hot loops.
- Prefer direct property access for known paths.
- Benchmark before accepting complexity.
- Distinguish compile-time cost from execution-time cost.

## Current Initial Goal

The initial migration goal is the typed operator-chain foundation:

```ts
const User = JIT.object({
  id: JIT.number(),
})
  .partial()
  .required()
  .readonly();
```

Definition of done:

- `JIT` exposes the minimum required factories.
- `User.schema` exposes the AST.
- Runtime schemas preserve `type`, `_type`, `def`, `annotations`.
- `_type` is `null` at runtime and typed at compile time.
- `partial()`, `required()`, and `readonly()` have runtime and type tests.
- `nullish()` represents `T | null | undefined` and belongs with the core wrapper operators.
- Invalid operators are rejected by TypeScript.
- Original schemas are not mutated.
- Legacy directories remain until migration conditions are satisfied.
- `pnpm format:check`, `pnpm lint:check`, `pnpm test`, and `pnpm build` pass.
