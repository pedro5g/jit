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

| Stage                   | Input → output               | Lowering                                                                                                           |
| ----------------------- | ---------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `json.decode`           | JSON text → value            | Schema-directed scanner for a supported adjacent parse validation; explicit native fallback otherwise.             |
| `validate`              | value → validated value      | Runs during token consumption in the specialized JSON backend, or through the emitted validator for other sources. |
| `query`                 | array → array                | Adjacent `filter`/`select` nodes collapse into one indexed query loop.                                             |
| `map`                   | value or array → target      | Shape-specific mapper; `many` is an indexed loop.                                                                  |
| `transform`             | value or array → target      | Per-field transform source; collection mode is an indexed loop.                                                    |
| `update`                | value or array → same schema | Immutable structural update; a static patch is bound once.                                                         |
| `security`              | value or array → same schema | Compiled `sanitize` or PII `mask` rewrite.                                                                         |
| `to.json` / `to.binary` | value → boundary text/bytes  | Specialized serializer or codec.                                                                                   |

The resulting hot call is one generated `execution(input)` function with
emitted helpers in its lexical scope. It does not invoke a chain of
`previous(value)` closures and it never recompiles an intermediate artifact.

## JSON parsing and validation

`JIT.json.parse(schema).validate()` inspects the complete schema before
lowering. Objects, arrays, tuples, records, JSON primitives, literal/enum
values, the common nullable/optional/default/readonly wrappers, and their
supported declarative checks use an emitted scanner. Strings, numbers, fields,
array items, defaults, and unknown-key policies are checked or applied as the
corresponding token is consumed. The generated hot source contains no
`JSON.parse` and throws the same `JITValidationError` shape after collecting
validation issues.

The compiler selects this backend only when it can preserve the full parse
semantics. Refines, callback transforms/pipes, coercions, unions and other
not-yet-lowered nodes retain `JSON.parse` plus the generic compiled validator;
`Compiler.jsonDecoderSupport(schema)` exposes the reason. This is an explicit
compatibility boundary, not silent partial validation. The resulting value is
still materialized. Chunked/incremental input remains the job of the streaming
API.

Performance is shape-dependent. Fixed small objects can beat `JSON.parse` plus
validation because the second traversal disappears; native parsing can still
win for large numeric arrays. `pnpm bench:json-decode` records both cases and
also compares generated Typia validation and Zod, while labeling parse-only
and fail-fast baselines that do less work. Backend expansion and selection must
follow those measurements rather than a universal speed claim.

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
- schema-directed JSON decode, binary decode, query materialization, mapper
  batches, collection transforms/updates/security rewrites, and serialization
  are allocation boundaries when their semantics require output values.

In particular, `filter(...).map(...)` can require a filtered array before the
mapper's target object loop, and JSON decoding must materialize the input value.
The terminal map/JSON backend avoids the target _array_, but mapper callbacks
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
