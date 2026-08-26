# Runtime / Define / AOT API Parity

Updated: 2026-08-26

## Contract

JIT has one public operation API. A declaration written against
`@jit-compiler/jit/runtime` must be expressible with the same names, arguments,
composition and public types through `@jit-compiler/jit/define`. Generation
then lowers the definition to a standalone artifact with the same observable
semantics.

This is **API and semantic parity**, not byte-for-byte source parity. Runtime
JIT may bind values into `globalThis.Function`; AOT reconstructs safe values in
an import-free module. Both lower the same immutable descriptor or semantic
plan, but the generated source may differ when the host boundary requires it.

## Host behavior

```ts
import { JIT as RuntimeJIT } from "@jit-compiler/jit/runtime";
import { JIT as DefineJIT } from "@jit-compiler/jit/define";

const RuntimeUser = RuntimeJIT.object({ id: RuntimeJIT.number() });
const DefineUser = DefineJIT.object({ id: DefineJIT.number() });

export const runtimeIsUser = RuntimeJIT.validate.is(RuntimeUser);
export const generatedIsUser = DefineJIT.validate.is(DefineUser);
```

`runtimeIsUser` compiles lazily and executes in the current process.
`generatedIsUser` is a typed, deliberately non-executable descriptor until
`jit generate` lowers it. The generated function has no dependency on the JIT
runtime.

## Reconstructive artifacts and callbacks

Artifacts retain semantic metadata: schema, operation or execution plan,
static options, binding names and the runtime binding values needed for JIT
execution. AOT serializes only values it can reconstruct without changing
meaning.

Supported bindings include data-only primitives, arrays and plain objects,
regular expressions, and self-contained user functions. Native functions,
bound functions, cyclic/non-data objects and callbacks with inaccessible
closure dependencies are barriers. Generation reports the declaration and
skip reason; it never substitutes a generic runtime walker or emits code that
only appears equivalent.

## Composition and fusion

Parity applies to complete compositions, not only leaf operations:

```ts
export const activeIds = DefineJIT.json
  .parse(DefineJIT.array(DefineJIT.object({
    id: DefineJIT.number(),
    active: DefineJIT.boolean(),
  })))
  .validate()
  .filter((query) => query.eq("active", true))
  .select("id")
  .to.json();
```

AOT emits one physical execution program. Native JSON parsing, generated
validation, filtering, projection and the JSON sink remain in user order, and
safe fusion removes intermediate operation closures. Materializing boundaries
remain when their semantics require them.

## Operation matrix

| Family | Runtime | Define | Standalone AOT | Notes |
| --- | --- | --- | --- | --- |
| validation | yes | yes | yes | selection-aware validation source |
| equal, diff, hash, clone | yes | yes | yes | schema-specialized operations |
| JSON and binary codec | yes | yes | yes | transport representation is preserved |
| mapper, transform, update | yes | yes | yes | reconstructible bindings required |
| mask and sanitize | yes | yes | yes | static schema security metadata |
| eager query | yes | declaration-compatible | yes | canonical migration to `JIT.cqrs` is in progress |
| iterator/visitor query | yes | declaration-compatible | yes | backend is part of the query artifact |
| CQRS input | yes | declaration-compatible | yes | structural `~query` remains V1 |
| Runtime Classes and DDD | yes | yes | yes | class artifact emitted in the same module |

New public operation families must add a row only when runtime behavior,
define stubs, generated JavaScript/TypeScript, parity tests and tree-shaking
coverage all exist. “Declaration-compatible” entries are tracked migration
work: they share reconstructive query artifacts today, while the define host is
being made deliberately non-executable for every terminal artifact.

## Generated TypeScript and JavaScript

TypeScript output contains executable optimized code plus structural public
types in one `.ts` file. JavaScript output contains only executable ESM. Output
location does not change format, and neither output imports the JIT package.
Per-file generation produces independently executable modules; the barrel only
re-exports them.

## Purity and tree-shaking

Generated artifacts do not capture runtime schemas, constructors, descriptor
registries or compiler packages. A generated module includes only helpers
required by its selected artifacts. Adding a new artifact family requires a
focused tree-shaking fixture proving that unrelated compilers and helpers are
absent.

The runtime package is side-effect free. Artifact metadata is attached through
weak registries and immutable descriptors; it does not require a global list of
all operations.

## Runtime versus AOT metrics

Parity is a correctness guarantee, not a blanket speed claim. Hot-operation
benchmarks compare:

| Variant | Includes compile cost | Runtime compiler dependency |
| --- | --- | --- |
| idiomatic JavaScript | no | no |
| handwritten optimized ceiling | no | no |
| runtime JIT | reported separately | yes |
| generated AOT | no | no |

Each feature document records environment, data set, warm-up, iterations,
throughput or latency, generated source size and allocation measurements where
relevant. Results are published only after running the reproducible harness.

## Skip reasons

Generation may skip an artifact only with a deterministic diagnostic. Typical
reasons are an inaccessible callback closure, native or bound callback,
non-serializable static data, a Runtime Class not emitted in the same module,
or a stage whose standalone lowering is not implemented. A skip is never
reported as successful parity.

## Contributor checklist

Before merging a public operation:

1. add it once to the entrypoint parity matrix;
2. verify the runtime and define namespace shapes;
3. assert reconstructive metadata on both hosts;
4. prove define artifacts cannot execute before generation;
5. compare runtime and generated results, including edge cases;
6. verify deterministic generated source and public TypeScript types;
7. add JavaScript/TypeScript AOT and tree-shaking fixtures;
8. document barriers, allocation model, complexity and measured benchmarks;
9. run format, lint, test and build checks;
10. inspect the generated source for generic walkers and unnecessary helpers.

