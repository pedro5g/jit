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

## Execution Plans, Runtime Classes, And DDD

- New boundary composition belongs in an immutable `ExecutionPlan`; lower it once
  to one specialized function rather than chaining runtime closures.
- A `construct` stage may materialize a Runtime Class only after a validation
  stage establishes `schema-validated`. Pass the internal validated-state marker
  only across that proven boundary; ordinary constructors and `with()` must
  retain validation.
- AOT output must never capture runtime constructors, descriptors, registries,
  or the JIT package. A class-construction pipeline is AOT-compatible only when
  its named Runtime Class artifact is emitted in the same generated module.
- Capabilities are immutable descriptors installed once on a prototype. Keep
  them tree-shakeable and do not add per-instance infrastructure for methods.
- `valueObject`, `entity`, `aggregateRoot`, and `domainEvent` reuse Runtime
  Class machinery. Aggregates keep controlled mutation and an ordered event
  buffer; readonly schema fields stay out of patches. These DDD presets live
  under the `JIT.ddd` namespace and preserve canonical `create()`/`hydrate()`
  names. `JIT.class` stays top level: it is the primitive the presets
  configure, and non-domain features build on it directly.
  Domain-event `create()` accepts payload input, while direct construction and
  hydration use the complete event envelope. Rename factories only through an
  explicit `.factories(...)` call.

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

## The Site And Its Assistant (apps/site)

The documentation assistant answers from generated context rather than from the source
tree, so changing the public API, the documentation or the workspace leaves it holding a
description of a library that no longer exists. **Rebuild that context in the same change**,
from `apps/site`:

```bash
pnpm gen:api-surface   # the surface the answer audit is checked against
pnpm gen:docs-index    # retrieval index; its version key invalidates cached embeddings
pnpm gen:dts           # Monaco declarations for the workspace
pnpm gen:lab           # browser AOT bundle used by Generate and by example verification
pnpm audit:docs        # executes every documentation example against the real library
pnpm eval:ghost        # retrieval against the golden question set
```

Context that is written by hand and must be updated by hand: `lib/assistant/graph.ts`
(concepts, verified facts, one runnable example per concept), `lib/assistant/solutions.ts`
(symptom to API recipes) and `lib/assistant/prompt.ts` (the always-true block). Their
examples are executed by the test suite, so a stale one fails the build.

Rules the assistant and workspace are held to:

- No unaudited answer is shown. Every jit code block the assistant writes is transpiled
  and executed in a disposable worker before the reader sees it; a block that throws,
  loops or uses an undeclared value is an audit finding.
- Generative behaviour is beta and says so. The verified floor (retrieval, concept facts,
  executed examples) is what the product promises; the model is a layer on top.
- The workspace holds a project. `lib/workspace/project.ts` owns path rules, identical to
  the artifact protocol's, and `lib/workspace/bundle.ts` links files so each dependency
  keeps its own scope.
- The entrypoint import line belongs to the workspace and is restored when edited.

## Performance Principles

- Avoid work.
- Specialize when schema information is known.
- Preserve stable object shapes.
- Avoid unnecessary allocation and indirection.
- Avoid generic callbacks in hot loops.
- Prefer direct property access for known paths.
- Benchmark before accepting complexity.
- Distinguish compile-time cost from execution-time cost.

## Feature Acceptance

Every new public operation must solve a measured problem.

Before implementation:

1. audit existing operations and IR;
2. document what can be reused;
3. define the expected complexity or allocation improvement;
4. build a handwritten optimized ceiling benchmark when possible.

Do not add a public operation only for API convenience if specialization cannot
avoid work, allocations, materialization, indirection, or improve algorithmic
complexity. Start by asking whether the operation, allocation, intermediate
value, callback dispatch, or full scan can be avoided entirely.

## Runtime / AOT Parity

The public API is one-to-one between runtime and define/AOT hosts.

Every new runtime artifact must:

- be expressible through `@jit-compiler/jit/define` with the same API;
- register reconstructive metadata;
- generate a standalone AOT equivalent in JavaScript and typed TypeScript when applicable;
- preserve public typing and runtime semantics;
- have runtime/AOT semantic parity tests;
- have deterministic generated-source coverage;
- have a focused tree-shaking fixture.

Composed operations must lower as one optimized AOT program where fusion is
safe. API parity does not require byte-identical source, but both hosts must
preserve the same observable contract. Unsupported runtime bindings must be
reported as explicit AOT skip reasons and must never be silently miscompiled.

## Query

`JIT.cqrs` is the canonical public query namespace. Keep `JIT.query` only as a
compatibility path and do not introduce new operations exclusively on it. Reuse
the existing query AST and `QueryProgram`; do not create a second query engine.

Keep the structural `~query` protocol at version 1 until a published external
compatibility boundary exists. Evolve V1 deliberately when needed, and never
expose private `QueryProgram` or `PhysicalQueryPlan` nodes through the standard.

Semantic query plans describe what is requested. Schema facts and collection
hints feed a separate physical planner that chooses how to execute it. Explain
output must make the selected strategy, materialization barriers, expected
complexity, and relevant facts reviewable, and must not expose access-path
internals or query AST nodes.

A physical strategy must never change the answer. Every access path needs a
differential test against the scan it replaces, covering present, absent and
boundary keys. A strategy that can lose to a scan must document the regime
where it does, with the measured number — an index that is rebuilt instead of
reused is slower than the scan it replaced, and the documentation says so.

Do not add a public operation that asks callers to name an algorithm. The
query describes the request; facts on the collection decide the access path.

## Feature Documentation

Every public feature must add or update its `docs/features/*` document in the
same change. A complete feature document covers:

- problem and why schema specialization belongs in JIT;
- canonical API and exact semantics;
- compiler, generated-code and physical-strategy design;
- allocations, materialization and algorithmic complexity;
- runtime, define and AOT behavior;
- reproducible benchmark methodology and measured results;
- tradeoffs, best practices and explicit non-goals.

Do not publish a performance claim without a reproducible benchmark. Hot
operation benchmarks compare idiomatic JavaScript, a handwritten optimized
ceiling, runtime JIT and AOT, and include allocation or memory measurements
where relevant.

## Current Evolution Goal

JIT is a compiler of specialized data operations. The current evolution work
consolidates query under `JIT.cqrs`, introduces semantic-to-physical planning,
and builds reusable ordering, indexing, projection, reconciliation,
authorization and transport plans. High-level abstractions must disappear from
AOT output: no schema walker, query interpreter, permission rule walker,
runtime compiler, or unrelated high-level dependency may remain.
