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
const isUser = JIT.validate(User).is().compile();
const parseUser = JIT.validate(User).parse().compile();
const equalUser = JIT.equal(User).compile();
const stringifyUser = JIT.json(User).stringify().compile();
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
- Runtime compiled functions expose non-enumerable:
  - `source`
  - `hash`
  - `compile()`
  - `explain()`
- `~standard` is cached per schema and closes over compiled `safeParse`.
- CLI:
  - `jit doctor`
  - `jit explain`
- AOT:
  - `diff` standalone/grouped generation.
- Benchmarks:
  - `pnpm bench:flows` for high-volume validate + query + JSON pipelines.

## Next Phases

1. Introduce explicit host contracts in code:
   `CompilerHost`, `CompilationRequest`, `CompiledArtifact`.
2. Move current emitters behind `compileArtifact(...)` without changing
   generated output.
3. Add define-host stubs for future `@jit/define` style entrypoints.
4. Add query params/external references for AOT-safe dynamic values.
5. Expand AOT operation parity: update/fromJSON and operation metadata in
   generated plans.
6. Add `jit generate --watch` worker isolation and persistent artifact hashes.
7. Keep benchmark coverage split between:
   - hot-call microbenchmarks;
   - cold compile/startup;
   - high-volume data flows;
   - AOT bundle and memory profiles.
