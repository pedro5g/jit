# jit Architecture

jit is a compiled data engine: a schema described once becomes specialized
JavaScript for every operation over that shape. This document describes the
project flow end to end and the rules every part follows.

User-facing feature guides live in [docs/features](./features/README.md).

## The pipeline

```text
DSL (JIT.* builders)
  -> Schema AST (core/ats: TypeName + defs + annotations + hints)
  -> per-operation plan / IR (compiler/ir, query plans, mapper plans)
  -> optimizer passes (equal and query only — separate cost models)
  -> codegen (one emitter per operation)
  -> globalThis.Function (runtime JIT)  |  pure .mjs/.cjs/.d.ts (AOT)
```

Everything expensive — schema traversal, wrapper resolution, hint
resolution, IR construction, optimization, source emission — happens once,
in the compilation path. The emitted function interprets nothing.

## Module map (`packages/jit/src`)

| Area           | Responsibility                                                                                                                                                                  |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `core/ats`     | schema AST: `TypeName`, def shapes, `ChecksDef`, `Infer` type helpers                                                                                                           |
| `core/builder` | fluent chain (`.min()`, `.email()`, wrappers, hints); check methods are type-gated per schema kind                                                                              |
| `core/hints`   | manual strategy hints (`entity`, `indexBy`, `hash`, `ordered`, ...)                                                                                                             |
| `transforms`   | pure schema→schema transforms (`partial`, `pick`, `omit`, `merge`, wrappers)                                                                                                    |
| `compiler`     | one emitter per operation; shared IR (`ir/ir.ts`) + optimizer passes for equal and query; string emitters (validate/serialize/codec/scrub/stream) follow the same codegen rules |
| `runtime`      | compile cache, keyed-index cache, hash primitives, boundary scanner (stream), artifact registry                                                                                 |
| `factories`    | the public `JIT.*` namespace: schema factories + every `compile*` entry point + `model`/`compile` aggregations                                                                  |
| `aot`          | Prisma-style generator (`generate`), schema discovery, config; `src/cli.ts` backs the `jit` binary                                                                              |
| `mcp.ts`       | stdio MCP server for agents: project context, AOT inspection, and AOT generation tools                                                                                          |
| `shared`       | source-emission helpers (`parse.ts`: escaping, identifiers, key access) and the `regexes` format library                                                                        |
| `errors`       | typed `JITError` / `JITValidationError`                                                                                                                                         |

## Schema AST

Every schema node keeps this stable runtime shape and property order:

```ts
{
  (type, _type, def, annotations);
}
```

- `_type` is a TypeScript phantom output type, always `null` at runtime;
  the assertion is centralized in schema construction.
- Definitions live in `def`; prefer stable def shapes over conditionally
  added properties.
- Checks (`min`, `email`, formats, ...) are declarative entries in
  `def.checks` with optional custom `message`; `JIT.coerce.*` is a `coerce`
  flag on the base def (zod semantics — not a wrapper).
- Transforms (`partial`, `pick`, `merge`, ...) return transformed schemas,
  not new AST node kinds.

## Codegen rules (non-negotiable, every emitter)

1. Runtime values ALWAYS travel as external bindings to `Function`
   (`__q0`, `__v0`, `__m0`, `__c0`) — never interpolated into source. AOT
   may inline ONLY RegExp and JSON-primitive values.
2. Static keys only — no `for...in` / `Object.keys` on known shapes;
   classic indexed loops; no closures inside generated functions; no
   `push` (use `out[j++]`); checks ordered cheapest-first
   (`typeof` → null → numeric → length → regex).
3. Never invert `>` / `>=` / `<` / `<=` under `not` — NaN breaks the
   equivalence (De Morgan over and/or only; eq↔neq inversion is fine).
4. Large functions are split so V8 TurboFan can inline them; helper
   functions live at the top level of the compiled scope (typia-style
   `iu1`/`pu1` union predicates), never per-call closures.
5. Generated source is deterministic: `query.test.ts` asserts byte-exact
   goldens (fixed var names `value/len/out/j/i/item/entry/seen`, no Scope
   allocator) and `generated-source-snapshots.test.ts` locks composed
   scenarios behind snapshot review.

## Compile cache

`runtime/cache/compile-cache.ts` has two tiers:

- **Tier A** — `WeakMap schema → applied function` for operations whose
  bindings derive from the schema alone (equal, clone, diff, update, hash,
  validator, mask, sanitize, serialize, codec-per-version).
- **Tier B** — cached `{ source, create }` template, re-applying user
  bindings per compile (query, mapper). User values must never be cached
  into a shared closure.

Tier B templates also feed the **artifact registry**
(`runtime/artifact-registry.ts`): compiled query/mapper artifacts remember
their source + bindings, while validator and operation artifacts remember the
schema/op pair. `jit generate` uses that metadata to re-emit explicitly
exported standalone functions and dev-defined extras aggregated via
`JIT.compile(schema, { ... })`.

## Validation engine

`compiler/validate/emit-validate.ts` emits up to three functions sharing
one binding list: `is` (early-return boolean), `safeParse` (issue vector +
single-pass output rebuild), and — when the schema contains promise
wrappers — `async safeParseAsync` (settles promises, validates resolved
values). Unions validate deeply through hoisted sync predicates;
discriminated unions dispatch on the literal tag. Output is returned by
reference when nothing rebuilds (`needsBuild` gates every allocation).

The public runtime facade `JIT.validate(schema).is().compile()` is a thin
host-style layer over the same validator compiler and cache. It does not
introduce a second validation implementation. `JIT.validator(schema)` remains
the object facade, while builder `schema["~standard"]` closes over the
compiled `safeParse` function for Standard Schema interop.

The package exposes transitional host entrypoints while the monorepo is still
single-package: `jit/runtime` exports the runtime `JIT` namespace, and
`jit/define` exports the same schema DSL with AOT stubs for compiled
artifacts. `core/host.ts` owns the shared `CompilerHost`,
`CompilationRequest`, `CompiledArtifact`, descriptor symbols, and AOT artifact
types that future package splits will reuse.

## Wire formats (breaking-change surface)

- **Binary codec v2** (`compiler/codec/emit-codec.ts`): byte 0 is the
  schema version; object optionals are a 2-bit-per-field bitmask; ints are
  guarded int32; strings length-prefixed UTF-8 written via
  `TextEncoder.encodeInto`. Changing any layout detail is a breaking wire
  change — bump the version byte semantics deliberately.
- **Binary rowsets** (`compiler/binary-rowset.ts`): in-memory only, not a
  transport format. Flat object arrays compile into fixed-width rows in one
  `ArrayBuffer`; optionals/nullables use 2-bit row masks, string/literal
  fields use per-field integer dictionaries, and `JIT.query(rowset)` emits
  byte-offset scans. The adaptive memory layout keeps mixed rows packed, uses
  typed views when naturally aligned, and supports explicit aligned and
  columnar modes. Columnar storage keeps one buffer with a leading mask plane
  and per-field contiguous lanes; generated queries bind only the column bases,
  views, and dictionaries they touch. This layout may evolve independently
  from codec v2 because it is not persisted across processes.
- **Streaming** (`compiler/stream.ts` + `runtime/stream/boundary-scanner.ts`):
  the boundary FSM must survive tokens cut across chunks, including inside
  UTF-8 sequences.

## AOT generator

`aot/generate.ts` writes a fully self-contained dual package:

- `index.mjs` + `index.cjs` + `index.d.ts`/`.d.cts` + `package.json`
  (exports map, `sideEffects: false`);
- optional thin subpath entrypoints (`user.mjs`/`user.d.ts`) for
  `#jit/user`-style imports, plus deterministic `manifest.json` and
  `plans/*.json` review files when enabled;
- zero imports — the validation error class and runtime helpers
  (keyed-index cache, hash primitives) are inlined;
- export shape is explicit and bundle-oriented: standalone compiled functions
  are emitted with the exact export name the developer declared
  (`export const User_is = selected.is` -> `User_is`); object-style
  `JIT.compile(schema, { ... })` markers emit only the grouped object
  (`User.is`). Raw schemas and array-style compile markers do not emit AOT
  output;
- the generator never emits an operation outside the selected surface: object
  markers use only the keys present in the compiled object; standalone output
  uses only exported registered functions;
- `.d.ts` types anchor on the dev's schema file via
  `import("jit").Infer<typeof import("./user.jit.js").User>` — inference is
  the single source of truth (`aot/emit-type.ts` is only the fallback for
  programmatic generation without a source file);
- `JIT.compile` markers restrict generation to the requested ops and add
  dev-defined extras from the artifact registry; anything whose bindings
  hold callbacks is skipped with a reported reason, never miscompiled.

CLI/config: `jit init` writes a typed `jit.config.*` plus a starter
`jit/user.jit.ts` using `jit/define`. `jit doctor` reports resolved
config/discovery without generating; `jit explain` and `jit list` load
declaration files and list buildable grouped objects plus standalone
functions; `jit inspect <export> --stage plan|source|declaration` prints the
collected descriptor or generated review output; `jit clean` removes the
configured generated directory. `entries` is optional; when omitted,
`jit generate` scans from the project root. `entries` accepts files,
directories, and globs, with legacy `schemas` preserved as an alias.
`patterns` controls directory scans (default `**/*.jit.ts`). The scanner skips
`node_modules`, dot-dirs, and build output. If no buildable exported
functions/objects are found, the CLI warns and writes nothing. TypeScript
schema files load natively on runtimes that strip types, falling back to
`jiti` when installed.

## Optimizer boundaries

Equal-only passes (inline-vars, optimize-cost, reorder-compares, ...) must
NOT run on query IR; query has its own `normalize-logic` +
`reorder-conditions` passes. Their cost tables intentionally differ — do
not unify without re-benchmarking.

## Conventions

- ESM; local imports use emitted `.js` extensions; `import type` for
  type-only edges; named exports preferred; no package-root imports inside
  the package.
- No new `any` outside deliberate boundaries; `// @ts-expect-error` (never
  `@ts-ignore`) for intentional invalid-API tests.
- Tests colocated under `__tests__`; typed APIs pair runtime assertions
  with `expectTypeOf`; benchmarks (mitata) live in `bench/` with results
  gitignored.

Verification:

```bash
pnpm format:check && pnpm lint:check && pnpm test && pnpm build
```
