# Composable execution pipelines

The runtime API is built around one immutable `ExecutionPlan`, not a stack of
facade objects. A source, every operator, and a sink append a declarative
stage. The final callable lowers the entire plan once, on first use.

```ts
const PublicUsers = JIT.json
  .parse(JIT.array(User))
  .validate()
  .transform(PublicUser, { name: (name) => name.trim() })
  .update({ visible: true })
  .sanitize()
  .mask()
  .filter((q) => q.eq("active", true))
  .select("id", "name", "email")
  .to.json();

const json = PublicUsers(requestBody);
```

`PublicUsers` is directly callable. `.compile()` is only an optional warm-up;
it does not create a different artifact. `.plan` and `.explain()` expose the
same immutable descriptor for diagnostics and AOT generation.

## Composition contract

Every stage has an input/output representation, schema, effects, and facts it
establishes. This lets runtime and AOT use the same semantic program.

| Stage | Input → output | Lowering |
| --- | --- | --- |
| `json.decode` | JSON text → value | Native `JSON.parse` in the generated entry function. |
| `validate` | value → validated value | Schema-specific validator emitted in that entry function. |
| `query` | array → array | Adjacent `filter`/`select` nodes collapse into one indexed query loop. |
| `map` | value or array → target | Shape-specific mapper; `many` is an indexed loop. |
| `transform` | value or array → target | Per-field transform source; collection mode is an indexed loop. |
| `update` | value or array → same schema | Immutable structural update; a static patch is bound once. |
| `security` | value or array → same schema | Compiled `sanitize` or PII `mask` rewrite. |
| `to.json` / `to.binary` | value → boundary text/bytes | Specialized serializer or codec. |

The resulting hot call is one generated `execution(input)` function with
emitted helpers in its lexical scope. It does not invoke a chain of
`previous(value)` closures and it never recompiles an intermediate artifact.

## JSON parsing and validation

`JIT.json.parse(schema).validate()` deliberately uses the engine's native
`JSON.parse`, then passes its result immediately to the schema-specific
validator in the same generated execution function. Native parsers are highly
optimized C++/Rust VM code in supported engines; replacing them with a
JavaScript token parser would add a second parser and is not assumed to be
faster.

This guarantees one public callable and one lowering decision, but JSON text
is still materialized into a JavaScript value before validation. That is a
physical boundary, not a hidden claim of streaming or zero-allocation token
validation. Use the streaming APIs for chunked input, and benchmark a
schema-directed parser separately before adding one.

## Ordering and type safety

Operators run in written order. For example, the pipeline above validates the
wire value before it transforms it, makes the immutable update, sanitizes,
masks PII, filters, projects, then serializes. The input value is never
mutated by `update`, `mask`, or `sanitize`.

`transform(targetSchema, fields)` is explicit about the output schema. A
transform preserves the source object's field set and changes field values;
use `.map(targetSchema, overrides)` for projections, renames, or a different
shape. This makes the next stage, JSON sink, and generated declaration
type-safe. If a callback can create a value outside `targetSchema`, append
`.validate()` after the transform; callbacks remain external bindings and are
not trusted by the compiler.

For collections, `transform`, `update`, `mask`, and `sanitize` apply to each
element. `filter` and `select` are only available when the current schema is
an array. `map` changes the current schema to its target, so subsequent
operators use the right shape.

## Physical fusion and barriers

Semantic composition does not mean every operation can safely share one loop.
The current backend guarantees the following:

- consecutive queries use the final query program and one output loop;
- collection transforms, updates, masks, and sanitizers use indexed loops,
  never `Array#map`;
- a terminal `map(...).to.json()` maps and serializes each source item in one
  JSON-output loop, avoiding the mapped collection allocation;
- sources, validators, queries, mappers, transforms, updates, security
  rewrites, and sinks live in one generated execution closure;
- `JSON.parse`, binary decode, query materialization, mapper batches,
  collection transforms/updates/security rewrites, and serialization are
  allocation boundaries when their semantics require output values.

In particular, `filter(...).map(...)` can require a filtered array before the
mapper's target object loop, and `JSON.parse` must materialize the input value.
The terminal map/JSON backend avoids the target *array*, but mapper callbacks
and nested target values can still require a per-item target object. A direct
field-to-serializer emitter is a separate optimization and must not be claimed
until it has measurements and regression coverage.
The plan preserves those boundaries instead of reordering user-visible work.
Future loop fusion must be introduced only with deterministic source tests and
measurements that prove it beats the existing specialized backends.

## AOT

Export the same artifact from a `*.jit.ts` file using the `define` entrypoint.
`jit generate` emits one import-free closure with the same stage order.

```ts
import { JIT } from "@jit-compiler/jit/define";

const User = JIT.object({
  id: JIT.number(),
  active: JIT.boolean(),
  name: JIT.string(),
});

export const ActiveNames = JIT.json
  .parse(JIT.array(User))
  .validate()
  .transform(User, { name: (name) => name.trim() })
  .update({ active: true })
  .filter((q) => q.eq("active", true))
  .select("id", "name")
  .to.json();
```

AOT accepts callbacks only when their source can be reconstructed without an
inaccessible closure. Update patches must be data-only static values; cyclic
objects, accessors, class instances, and dynamic callbacks are rejected with a
reported skip reason rather than being silently changed.

## Test obligations

Any new stage must have runtime and type-inference tests for construction,
ordering, source lowering, output, error behavior, and input immutability. It
also needs an AOT test from both runtime artifacts and `define` stubs. Tests
must assert generated source stays import-free and that unsupported AOT
bindings are skipped explicitly.
