# Dual JIT + AOT Execution Plan

Updated: 2026-07-11

## Direction

JIT keeps one compiler pipeline. Runtime JIT and AOT differ only by host:

- Runtime host instantiates emitted source with `Function`, registers
  artifacts, and caches by schema identity plus operation key.
- AOT host/collector discovers exported compiled artifacts from `*.jit.ts`
  files, reuses the same emitters, and writes standalone JS/types.

No schema operation should have a runtime implementation and a separate AOT
implementation with divergent semantics.

## Public API Shape

Preferred runtime surface:

```ts
import { JIT } from "jit/runtime";

const isUser = JIT.validate(User).is().compile();
const parseUser = JIT.validate(User).parse().compile();
const equalUser = JIT.equal(User).compile();
const stringifyUser = JIT.json(User).stringify().compile();
```

AOT declaration surface:

```ts
import { JIT } from "jit/define";

export const isUser = JIT.validate(User).is().compile();
export const stringifyUser = JIT.json(User).stringify().compile();
```

Compatibility surfaces remain:

- `JIT.validator(User)` object facade.
- `JIT.compile(User, { ...compiledFns })` grouped AOT marker.
- `JIT.model(User)` lazy all-ops namespace.
- `JIT.compileEqual`, `compileClone`, etc. low-level compiler entry points.

`JIT.equal(User)`, `JIT.clone(User)`, `JIT.diff(User)`, and `JIT.hash(User)`
are callable directly and also expose `.compile()` returning the same cached
function.

## Implemented In This Branch

- `JIT.validate(schema).is/parse/safeParse/parseAsync/safeParseAsync().compile()`.
- `JIT.equal/clone/diff/hash(schema).compile()`.
- `JIT.json()` still creates the JSON-value schema; `JIT.json(schema)` now
  exposes `.stringify().compile()` and `.parse().compile()`.
- `JIT.Infer<typeof Schema>` alias.
- `JIT.update(schema).patch({ field: JIT.param("name") }).compile()`.
- `JIT.query(schema).params({...})` and `JIT.const(value)` / `q.constant(value)`.
- `JIT.transform(schema).select(...).map(...).compile()` with inline built-in
  field transforms.
- `jit/runtime` and `jit/define` subpaths.
- Shared host contracts in `core/host.ts`.
- Define-mode AOT stubs that register artifacts and throw if executed.
- Runtime compiled functions expose non-enumerable:
  - `source`
  - `hash`
  - `compile()`
  - `explain()`
- `~standard` is cached per schema and closes over compiled `safeParse`.
- CLI:
  - `jit doctor`
  - `jit explain`
  - `jit list`
  - `jit inspect <export> --stage plan|source|declaration`
  - `jit clean`
  - `jit init` writes plan-shaped `entries`/`output` config plus a starter
    `jit/user.jit.ts`.
- AOT:
  - `diff` standalone/grouped generation.
  - `fromJSON` standalone/grouped generation.
  - optional subpath modules for `#jit/user`-style imports.
  - optional deterministic `manifest.json` and `plans/*.json`.
  - regression coverage proving final bundlers drop unused standalone
    generated functions and that grouped exports contain only explicitly
    selected operations.
  - conditional helper coverage for generated cache helpers: `__indexCache`
    only for indexed equality and `__hashCache` only for hash/hash-short-
    circuit operations.
  - post-generation runtime and TypeScript import smoke test against the
    generated `.mjs`/`.d.ts` package.
- Benchmarks:
  - `pnpm bench:flows` for high-volume validate + query + JSON pipelines.
  - `pnpm bench:load` for 10k/100k validation loads against TypeBox
    `TypeCompiler.Check`, TypeBox `Value.Check`, typia generated validators,
    and Zod, with persisted speed plus `heap/op` results.

## Next Phases

1. Move current emitters behind `compileArtifact(...)` without changing
   generated output.
2. Split schema builders into compiler-free core so `jit/define` no longer
   imports runtime compiler conveniences transitively.
3. Add external references for AOT-safe custom callbacks.
4. Expand AOT operation parity: update operation metadata in generated plans
   as new operations land.
5. Add `jit generate --watch` worker isolation and persistent artifact hashes.
6. Replace thin subpath re-export modules with independent per-entry bundles
   and add source maps.
7. Keep benchmark coverage split between:
   - hot-call microbenchmarks;
   - cold compile/startup;
   - high-volume data flows;
   - AOT bundle and memory profiles.
