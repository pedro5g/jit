# Contributing To JIT

Thank you for helping improve JIT. The project welcomes focused bug fixes,
tests, documentation, benchmarks, and API proposals that preserve the compiled
engine's performance model.

## Before Starting

1. Search existing issues and pull requests.
2. Open a feature issue before implementing a new public operator, AST node,
   wire-format change, or broad architectural migration.
3. Use the performance issue form for optimization work so the workload,
   baseline, environment, and memory methodology are recorded before code
   complexity is introduced.

Small fixes with an obvious contract can go directly to a pull request.

## Local Setup

JIT uses pnpm and Node.js 20 or newer.

```sh
pnpm install
pnpm test
pnpm build
```

Use the source condition for local scripts that should execute the TypeScript
implementation directly:

```sh
pnpm exec tsx --conditions @jit/source path/to/script.ts
```

## Engineering Rules

- Keep schema AST, fluent builders, transforms, and compiler emitters separate.
- Preserve stable runtime object shapes and deterministic generated source.
- Pass runtime values as compiler bindings; never interpolate untrusted values
  into `new Function` source.
- Avoid new `any`. Test runtime behavior and type inference together.
- Keep JIT and AOT behavior equivalent and test generated package imports.
- Do not add a generic runtime helper to solve a case the compiler can
  specialize statically.
- Treat binary codec changes as versioned compatibility changes.

Read [docs/architecture.md](docs/architecture.md) for the complete pipeline and
performance principles.

## Tests And Generated Source

Place Vitest tests near the owning module under `__tests__`. Public typed APIs
need positive `expectTypeOf` assertions and intentional invalid cases using
`@ts-expect-error`. Compiler changes should cover:

- runtime behavior for valid and invalid data;
- deterministic generated source or reviewed snapshots;
- runtime JIT and generated AOT parity;
- cache and binding isolation when user values are involved;
- ESM, CommonJS, and declaration output when exports change.

Run the complete gate before opening a pull request:

```sh
pnpm format:check
pnpm lint:check
pnpm release:check
pnpm test
pnpm build
pnpm release:pack
pnpm release:jsr:dry-run
```

## Performance Changes

Optimization pull requests must state what work is avoided and include a
reproducible benchmark. Separate compile cost, cold execution, warm execution,
heap allocation, retained memory, and bundle size. Record runtime version, CPU,
OS, architecture, data cardinality, valid/invalid distribution, warmup, sample
count, and the exact competitor versions.

Complexity is accepted only when a measured production-shaped workload benefits
and regression coverage protects the new path.

## Commits And Pull Requests

Use Conventional Commit subjects such as `feat:`, `fix:`, `perf:`, `docs:`,
`test:`, `refactor:`, `build:`, and `ci:`. Keep commits focused and do not add
automated tools as co-authors. Complete the pull request template and call out
breaking API, type, generated-source, or wire-format changes explicitly.
