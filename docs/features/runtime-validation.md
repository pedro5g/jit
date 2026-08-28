# Runtime Validation

Runtime validation compiles schema checks into specialized functions. The same
compiler path powers runtime JIT and AOT, so behavior stays aligned across
development and generated production builds.

## API

Use the capability namespace when you want one callable artifact. Validation
leaves are deliberately not duplicated at the root: use `JIT.validate.is`,
`JIT.validate.parse`, and `JIT.validate.safeParse`:

```ts
import { JIT } from "@jit-compiler/jit/runtime";

const User = JIT.object({
  id: JIT.number().int().positive(),
  name: JIT.string().min(2),
  email: JIT.string().email(),
});

const isUser = JIT.validate.is(User);
const parseUser = JIT.validate.parse(User);
const safeParseUser = JIT.validate.safeParse(User);
```

Use `{ ... }` when several operations should ship as one
object:

```ts
const UserValidator = {
  is: JIT.validate.is(User),
  parse: JIT.validate.parse(User),
  safeParse: JIT.validate.safeParse(User),
};

UserValidator.is(input);
UserValidator.parse(input);
UserValidator.safeParse(input);
```

Use `{ ... }` when you want an object-shaped runtime and
AOT marker:

```ts
export const UserModel = {
  is: JIT.validate.is(User),
  parse: JIT.validate.parse(User),
};
```

## Function Behavior

- `is(value)` returns `boolean` and exits on the first failure.
- `parse(value)` returns typed data or throws `JITValidationError`.
- `safeParse(value)` returns `{ success: true, data }` or
  `{ success: false, issues }`.
- Async variants compile only when the schema contains promise wrappers.

Prefer `is()` in hot filters and request gates when you do not need detailed
errors. Prefer `safeParse()` at boundaries where the caller needs structured
feedback. Prefer `parse()` when invalid input is exceptional and you want a
throwing API.

## Why It Is Faster

The validator emitter writes direct JavaScript:

- static property reads such as `value.id`;
- cheap checks first (`typeof`, null, array, integer, length, regex);
- early return for `is()`;
- classic indexed loops for arrays;
- hoisted helper predicates for unions and discriminated unions.

A generic validator usually walks a schema tree for every call. JIT walks the
schema once and emits the checks the engine would want to inline. That removes
per-call schema dispatch and reduces branch noise in hot code.

## Why It Uses Less Memory

`is()` is allocation-light because it does not build issue objects. For valid
data, `safeParse()` returns the original value when no output rebuild is needed.
Transforms/defaults/coercions allocate only when the schema semantics require a
new output.

The validator compiler also shares source within a selected validator object.
If `is`, `parse`, and `safeParse` are selected together, they are emitted from
one validator artifact instead of compiling unrelated generic functions.

## Standard Schema

The builder exposes `~standard` interop. Its `validate` path closes over the
compiled `safeParse`, so libraries using Standard Schema do not fall back to a
slow interpreted validator.

```ts
const standard = User["~standard"];
const result = standard.validate(input);
```

This should still be treated as an integration surface. When you control the
call site, call `is`, `parse`, or `safeParse` directly for the smallest and
clearest hot path.

## Best Practices

- Compile once at module scope, not inside request handlers or render loops.
- In a front-end bundle, import generated AOT validators instead of importing
  the runtime compiler.
- Use `is()` for high-volume filtering.
- Use `safeParse()` when collecting errors.
- Avoid callback refinements in AOT declaration files unless they are meant to
  stay runtime-only; callbacks cannot be serialized safely into generated JS.
