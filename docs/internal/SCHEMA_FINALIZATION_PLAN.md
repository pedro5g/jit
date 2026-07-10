# Schema Finalization Plan

Updated: 2026-07-10

This plan tracks the schema-core finish line for JIT. It intentionally ignores
`docs/internal/PERFORMANCE_PLANNING_AUDIT.md`; that audit is not part of this
stage.

## Goal

Finish the schema layer so every public schema feature is represented in the
stable AST, typed through `JIT.infer`, and compiled by the validator into
specialized JavaScript. No feature in this plan should rely on runtime schema
interpretation in hot paths.

## Non-Negotiables

- Preserve schema node shape and order: `type`, `_type`, `def`, `annotations`.
- `_type` stays `null` at runtime and typed at compile time.
- Public APIs use builders/factories; transforms remain pure schema-to-schema
  functions.
- Generated source keeps runtime values in external bindings.
- `is` emits a zero-allocation fast path.
- `safeParse` and `parse` allocate issue/path objects only on failure.
- Avoid reflection on known object shapes; use `Object.keys` only for
  `strict`, `loose`, `catchall`, and record-style dynamic keys.
- String mutators (`trim`, `replace`, `normalize`, case transforms) run only
  when requested by the schema.
- Every generated-source change gets tests that assert deterministic source.

## Public API Direction

### Validator Selection

`JIT.validator(schema)` becomes a selection facade. Accessing a property or
calling `.get(...)` compiles only the requested operation set.

```ts
const allLazy = JIT.validator(User);
allLazy.is(input); // compiles only `is` on first access

const selected = JIT.validator(User).get("is", "parse");
selected.is(input);
selected.parse(input);

const selectedByOptions = JIT.validator(User, {
  is: true,
  parse: true,
});
```

Supported validator operations:

- `is`
- `safeParse`
- `parse`
- `safeParseAsync`
- `parseAsync`

Async operations are emitted only when requested. If a selected async operation
needs a sync helper internally, that helper stays private to the compiled
closure and is not exposed as a public operation.

### Mapper Selection

Mapper follows the same selection pattern:

```ts
const mapper = JIT.mapper(User, PublicUser).get("map", "many");
const mapperByOptions = JIT.mapper(User, PublicUser, { map: true, many: true });
```

Supported mapper operations:

- `map`
- `many`

The mapper object should preserve existing artifact registration so AOT can
re-emit selected mapper functions when bindings are serializable.

### Aggregated Compile API

The runtime compile helper can still accept array selections for in-memory
compatibility:

```ts
JIT.compile(User, ["is", "parse"], extras);
```

For AOT markers, the project uses object aggregation:

```ts
const validator = JIT.validator(User).get("is", "parse");

export const UserCompiled = JIT.compile(User, {
  ...validator,
  stringify: JIT.serializer(User).stringify,
  findAdmins: JIT.query(JIT.array(User)).filter((q) => q.eq("role", "admin")).compile(),
});
```

`JIT.compile(schema, compiledObject)` returns a frozen object with:

- `schema`
- an internal operation-key list for AOT
- an internal grouped marker for discovery
- the exact provided compiled functions/objects

Reserved public keys: `schema`, `ops`, `extras`.

### AOT Export Rules

When a schema is exported as `JIT.compile(schema, compiledObject)`, generated
code exports only the grouped object:

```ts
import { User } from "@jit/generated";

User.is(input);
User.parse(input);
```

Generated operation functions may exist as internal `const`s, but must not be
exported as `User_is`, `User_parse`, etc. for aggregated markers.

Standalone AOT exports are allowed only when the developer explicitly exports a
registered compiled function/object:

```ts
const selected = JIT.validator(User).get("is", "parse");

export const User_is = selected.is;
export const User_parse = selected.parse;
```

The generated package preserves those export names exactly. Raw schemas and
array-style `JIT.compile(schema, ["is"])` markers do not generate fallback
functions. If discovery finds no buildable exports, the CLI warns and writes
nothing.

Tree-shaking is achieved by selection before generation: AOT emits only keys
present in the aggregated object or standalone functions explicitly exported
from `.jit.ts` modules. Property-level dead-code elimination inside a selected
object is not part of the contract.

## Feature Phases

### Phase 1 - Readonly Contract

Problem: object schemas currently infer readonly fields by default. That is
wrong. Only `.readonly()` should make the output readonly.

Tasks:

- Make `ObjectSchema` infer mutable object properties by default.
- Preserve readonly on schema internals (`schema.def`, shape definitions).
- Make `ReadonlySchema<T>` map containers precisely:
  - object -> `Readonly<T>`
  - array -> `readonly T[]`
  - tuple -> readonly tuple
  - map -> `ReadonlyMap<K, V>`
  - set -> `ReadonlySet<T>`
  - other values -> `Readonly<T>`
- Make validator parse output call `Object.freeze` for readonly schemas.
- Keep `is` unaffected by readonly, because readonly has no input validation
  impact.
- Keep update compiler rejecting readonly schemas.

Definition of done:

- `JIT.object({ id: JIT.number() })` infers `{ id: number }`.
- `JIT.object({ id: JIT.number() }).readonly()` infers
  `Readonly<{ id: number }>` and parse output is frozen.
- Tests prove original schemas are not mutated.

### Phase 2 - Object Rigidity And Shape Operators

Tasks:

- Add `.strict()` and `JIT.strictObject(...)` behavior.
- Add `.loose()` / passthrough behavior that preserves unknown keys.
- Add `.catchall(schema)` for unknown-key validation and output preservation.
- Add `.keyof()` returning an enum/literal-key schema.
- Allow `.pick("id", "name")` and `.omit("secret")` in addition to arrays.
- Make `.partial()` deep by default.
- Make `.required()` deep by default.
- Support path-specific `.partial("theme.color")` and
  `.required("theme.color")`.
- Ensure `.extend(...)` and `JIT.object({ ...Base.shape, extra: ... })` are
  supported without quadratic chained type cost.
- Preserve refinements/checks across safe extension paths.

Definition of done:

- Strict rejects unknown keys in `is`, `safeParse`, and `parse`.
- Loose preserves unknown keys in parse output.
- Catchall validates unknown keys and reports dynamic paths.
- Deep/path operators have runtime and type tests.

### Phase 3 - Collection, Record, File, Enum

Tasks:

- Add file checks: `.min(bytes)`, `.max(bytes)`, `.mime(type | type[])`.
- Add set checks: `.min(n)`, `.max(n)`, `.size(n)`.
- Make record validate keys through its key schema.
- Numeric record keys must accept string object keys that can be parsed as
  numbers, then validate the number schema.
- Enum-key records must be exhaustive by default.
- `record(...).partial()` makes enum-key records partial.
- `record(...).loose()` preserves incompatible keys without validation.
- Add `JIT.looseRecord(key, value)` as a convenience factory.
- Expand `JIT.enum` to accept arrays, native enum-like objects, and value
  objects.
- Add enum `.extract([...])` and `.exclude([...])`.

Definition of done:

- Exhaustive enum records reject missing keys.
- Partial enum records infer optional keys.
- Loose records preserve incompatible keys.
- Generated validator source has no generic per-value interpreter.

### Phase 4 - Logical And Check Operators

Tasks:

- Add builder `.or(schema)`, `.and(schema)`, `.xor(schema)`, `.not(schema)`.
- Reuse union/intersection where possible.
- Add an explicit AST node only where current composition cannot represent the
  semantics (`xor`, `not`).
- Add `.check(...)` for low-level property checks.
- Add `JIT.property(path, schema, message?)` for property validation.
- Support `JIT.instanceOf(URL).check(JIT.property("protocol", JIT.literal("https:")))`.
- Unify `.refine` and future super-refinement semantics behind a compiled
  check list.

Definition of done:

- Logical operators compile into specialized guards.
- Property checks bind callbacks/schemas safely and report correct paths.

### Phase 5 - Format And Primitive Parity

Tasks:

- Strings:
  - `startsWith`
  - `endsWith`
  - `includes`
  - `normalize`
  - `toLowerCase` alias
  - `toUpperCase` alias
  - `httpUrl`
  - `jwt`
  - custom `stringFormat(name, regex | predicate)`
- Numbers:
  - `gt`, `gte`, `lt`, `lte`
  - `nonnegative`, `nonpositive`
  - `step` alias for `multipleOf`
- BigInt:
  - min/max and sign checks
  - multipleOf/step
- Date:
  - min/max

Definition of done:

- Checks are declarative in `def.checks`.
- Validator orders cheap checks before expensive regex/callback checks.
- String mutators are never emitted unless requested.

### Phase 6 - Temporal Support

Temporal is Stage 4, but MDN still marks it as limited availability. Support
must use feature detection and avoid bundling a polyfill automatically.

Tasks:

- Add `JIT.temporal.instant()`.
- Add `JIT.temporal.plainDate()`.
- Add `JIT.temporal.plainTime()`.
- Add `JIT.temporal.plainDateTime()`.
- Add `JIT.temporal.zonedDateTime()`.
- Add `JIT.temporal.duration()`.
- Allow optional constructor binding for polyfill environments.

Definition of done:

- Native Temporal environments validate with direct constructor checks.
- Non-Temporal environments fail gracefully unless a constructor binding is
  supplied.
- AOT can serialize native Temporal support only when no custom constructor
  binding is required.

### Phase 7 - Selective Validator Compilation

Tasks:

- Introduce `ValidatorOp`.
- Teach `emitValidator(schema, { ops })` to emit only selected public ops.
- Split `parse` and `safeParse` emission while sharing private helpers when
  needed.
- Cache validators by schema identity and normalized op set.
- Update `emitValidatorSource` to accept op selection for tests.
- Preserve compatibility for call sites that need the full validator facade.

Definition of done:

- Source for `is` does not contain `safeParse`, `parse`, or async functions.
- Source for `parse` does not expose `safeParse` unless explicitly selected.
- Snapshots cover selected operation sets.

### Phase 8 - Aggregated Compile And AOT

Tasks:

- Replace array-op `JIT.compile` with object aggregation.
- Extend artifact registry to describe:
  - selected key
  - source
  - bindings
  - AOT type expression
  - whether the artifact is grouped-only
- Register artifacts for validator selections, serializer functions, mapper
  selections, queries, and codecs where feasible.
- Make AOT read aggregated marker keys.
- Generate grouped object exports only for aggregated markers.
- Generate standalone exact-name exports only for explicit registered
  functions.
- Ignore raw schemas and array-style compile markers in AOT.
- Preserve zero-import AOT output.

Definition of done:

- `import { User } from "@jit/generated"; User.is(...)` works.
- Aggregated AOT output does not export `User_is`.
- `import { User_is } from "@jit/generated"` works only when the declaration
  file exported `User_is` explicitly.
- AOT emits only keys present in the aggregated object.
- Non-serializable bindings are skipped with clear reasons.

## Testing Strategy

For every phase:

- Runtime tests in the closest `__tests__` directory.
- Type tests with `expectTypeOf`.
- Invalid API tests with `// @ts-expect-error`.
- Generated-source tests for validator/AOT changes.
- Snapshot updates only after inspecting deterministic source.

Target gates:

```bash
pnpm format:check
pnpm lint:check
pnpm test
pnpm build
```

## Current Implementation Start

Start with Phase 1. It is the narrowest change that corrects the type contract
and prepares parse output semantics for future schema operators.
