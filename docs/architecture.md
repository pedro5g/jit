# JIT Architecture

JIT is a TypeScript library for describing data structures once and compiling
specialized JavaScript operations over those structures.

The core execution model is:

```text
schema construction
  -> schema transforms
  -> operation-specific compilation
  -> specialized JavaScript function
  -> repeated runtime execution
```

The runtime function should not interpret a schema tree on every call. Schema
traversal, wrapper resolution, hint resolution, IR construction, optimization,
and source emission belong in the compilation path.

## Current Public Shape

The package root exposes namespace-oriented exports:

```ts
export * as Compiler from "./compiler/index.js";
export * as PipelineAST from "./core/ast/index.js";
export * as AST from "./core/ats/index.js";
export * as Builder from "./core/builder/index.js";
export * as Errors from "./errors/index.js";
export * as JIT from "./factories/index.js";
export * as Transform from "./transforms/index.js";
```

`JIT` is the main ergonomic namespace. It exposes schema factories, wrapper
operators, object transforms, and compiler entry points such as `compileEqual`,
`equal`, `compileClone`, `compileHash`, `compileDiff`, `compileUpdate`,
`compilePipeline`, query APIs, watch APIs, and object operations.

The generic `shared/equals` fallback and `JIT.deepEqual` API have been removed.
Schema-aware equality is compiled through `JIT.equal(schema)` or
`JIT.compileEqual(schema)`.

## Schema AST

Every schema node must keep this stable runtime shape and property order:

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
- `_type` is always `null` at runtime.
- The assertion that makes `_type` typed while storing `null` is centralized in
  schema construction.
- Definitions live in `def`.
- Prefer stable definition shapes over conditionally added properties.
- Transforms such as `partial`, `required`, `pick`, `omit`, `extend`, and
  `merge` return transformed schemas, not new AST node kinds.

## Builders And Transforms

The fluent builder chain is separate from the schema AST and from compiler code
generation.

Builder rules:

- Do not use `Proxy` for schema builders.
- Builder instances should stay small and stable, ideally `{ schema }`.
- Share behavior through prototypes, classes, or another allocation-conscious
  mechanism.
- Invalid operators should be rejected by TypeScript and should not be exposed
  accidentally at runtime.

Transform rules:

- Keep pure schema transforms in `src/transforms`.
- Reuse existing schema nodes and wrapper nodes.
- Do not mutate the input schema.
- Preserve annotations and definition fields according to the transform's
  documented semantics.

## Compilers

Compilers produce readable, deterministic, engine-friendly JavaScript.

Current compiler families include:

- equality;
- clone;
- hash;
- diff;
- immutable update;
- pipeline wrappers;
- query;
- watch;
- object operations such as merge, pick, omit, transform, normalize, groupBy,
  sortBy, and uniqueBy.

Compiler rules:

- `new Function` belongs only in compilation paths.
- Never interpolate untrusted runtime values into generated source.
- Use external bindings for callbacks, predicates, transforms, constructors,
  regular expressions, custom comparators, and unsafe literals.
- Centralize source helpers for identifier validation, string escaping, property
  access, literal emission, path emission, and binding allocation.
- Generated source must be deterministic enough for exact-source tests.
- Generated hot paths should avoid generic reflection, generic callbacks,
  temporary arrays, and unnecessary helper calls.

## Runtime

Runtime modules provide small, operation-specific support primitives:

- hash primitives and hash caches;
- keyed collection indexes;
- watched-list implementations.

Runtime helpers should live with the subsystem that owns their semantics. Avoid
adding broad utility modules unless at least two real consumers share the exact
same behavior.

`shared/parse.ts` and `shared/utils.ts` currently remain as compatibility
owners for source helpers and selected intrinsics. They should not grow into a
general dumping ground.

## Imports And Modules

The project is ESM.

Rules:

- Use `pnpm`.
- Local TypeScript imports must use emitted `.js` extensions.
- Use `import type` for type-only dependencies.
- Do not import from the package root inside the same package.
- Preserve namespace exports where they improve navigation and compatibility.
- Avoid turning namespace barrels into dependency-cycle hubs.
- Named exports are preferred.

## Typing

Avoid new `any`.

Use `unknown`, precise generics, conditional types, mapped types, and
discriminated unions. Any new `any` must be a deliberate compatibility boundary,
external-library boundary, or isolated implementation signature hidden behind
precise public types.

Use `// @ts-expect-error` for intentional invalid API tests. Do not use
`@ts-ignore`.

## Performance Principles

1. Avoid work.
2. Specialize when schema information is known.
3. Preserve stable object shapes.
4. Avoid unnecessary allocation and indirection.
5. Avoid generic callbacks in hot loops.
6. Prefer direct property access for known paths.
7. Use direct loops and read stable lengths once.
8. Keep generated functions monomorphic when possible.
9. Distinguish compile-time cost from execution-time cost.
10. Benchmark before accepting complexity.

## Tests

Use Vitest and colocate tests under `__tests__` directories.

Tests for typed APIs should pair runtime assertions with `expectTypeOf`
inference assertions. Generated-source tests should verify deterministic source
and behavior. Compatibility tests are only required for active compatibility
surfaces; removed legacy APIs should have their old tests removed or replaced by
tests for the new public API.

Required verification commands:

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
