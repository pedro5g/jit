# Runtime / Define / AOT API Parity

Updated: 2026-08-27

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
  .parse(
    DefineJIT.array(
      DefineJIT.object({
        id: DefineJIT.number(),
        active: DefineJIT.boolean(),
      }),
    ),
  )
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

| Family                    | Runtime | Define | Standalone AOT | Notes                                            |
| ------------------------- | ------- | ------ | -------------- | ------------------------------------------------ |
| validation                | yes     | yes    | yes            | selection-aware validation source                |
| equal, diff, hash, clone  | yes     | yes    | yes            | schema-specialized operations                    |
| JSON and binary codec     | yes     | yes    | yes            | transport representation is preserved            |
| mapper, transform, update | yes     | yes    | yes            | reconstructible bindings required                |
| mask and sanitize         | yes     | yes    | yes            | static schema security metadata                  |
| eager CQRS query          | yes     | yes    | yes            | define artifacts are deliberately non-executable |
| iterator/visitor query    | yes     | yes    | yes            | backend is part of the query artifact            |
| API query boundary/parser | yes     | yes    | yes            | `~query` stays V1; `explain()` ships as a frozen constant |
| API query authorization   | yes     | yes    | yes            | one generated parse-and-intersect function; rule values inline or the artifact is skipped |
| Declared patch (mutation plan) | yes | yes    | yes            | one copy-on-write function; declared values inline or the artifact is skipped |
| sort / ordering plans     | yes     | yes    | yes            | descriptor stays off the compiled plan           |
| index plans               | yes     | yes    | yes            | cache helper emitted only when an index is       |
| physical query access     | yes     | yes    | yes            | strategy is compiled in; never in `~query`       |
| composite aggregate       | yes     | yes    | yes            | one pass, one accumulator per field              |
| Runtime Classes and DDD   | yes     | yes    | yes            | class artifact emitted in the same module        |
| joins and distinct        | yes     | yes    | yes            | semantic plan; physical strategy stays private   |
| lookup and state reconcile | yes    | yes    | yes            | keyed physical plans and selective sinks         |
| project and changed       | yes     | yes    | yes            | shared ProjectionTree                            |
| state patch / canonical / key | yes | yes    | yes            | immutable reconstructive descriptors             |
| access control            | yes     | yes    | yes            | compiled action/rule dispatch                    |
| match                     | yes     | yes    | yes            | reconstructible handlers; closures are barriers  |
| migration                 | yes     | yes    | yes            | one version switch plus MapperPlan edges         |
| CSV                       | yes     | yes    | yes            | RFC scanner, validation and incremental sinks    |
| NDJSON                    | yes     | yes    | yes            | fused validation/filter/projection/serialization |

New public operation families must add a row only when runtime behavior,
define stubs, generated JavaScript/TypeScript, parity tests and tree-shaking
coverage all exist.

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

| Variant                       | Includes compile cost | Runtime compiler dependency |
| ----------------------------- | --------------------- | --------------------------- |
| idiomatic JavaScript          | no                    | no                          |
| handwritten optimized ceiling | no                    | no                          |
| runtime JIT                   | reported separately   | yes                         |
| generated AOT                 | no                    | no                          |

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
