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

## Diagnostics

Three execution modes over one plan, not three engines.

| | answers | issues |
| --- | --- | --- |
| `is` | a boolean, on the first failure | none are built |
| `safeParse` | `{ success, data \| issues }` | every independent failure |
| `parse` | the value, or throws once | the same list, on the error |

`parse(value)` and `safeParse(value)` report the same issues for the same
input; `parse` throws a `JITValidationError` carrying them, once, after
collecting. A factory configured with `.validate()` uses that same plan, so
`User.create(input)` reports what `safeParse` reports rather than the first
failure it happened to reach.

### What an issue carries

```ts
{
  path: "name",
  code: "too_small",
  expected: "length >= 3",
  message: "Must contain at least 3 characters",
  params: { minimum: 3, inclusive: true },
}
```

- **`code`** is machine-readable and stable. Branch on it.
- **`message`** is presentation only. Never write logic against it — a custom
  message is meant to replace it, and replacing one never moves the code.
- **`params`** carries the bound a translator needs, for the checks that have
  one. A format check has nothing structured to add and omits the key rather
  than carrying an empty object, and no issue ever holds the rejected value —
  that is how a diagnostic ends up in a log with data in it.

### What is collected, and what is not

Independent failures are independent answers. Sibling fields, several checks
on one value, and several elements of an array all report together:

```ts
JIT.validate.safeParse(User)({ name: "", email: "abc", age: 12 });
// three issues, one per field
```

A failed prerequisite suppresses everything that depended on it. `name: 123`
against `JIT.string().min(10).email()` reports one `invalid_type` — the length
and the format have nothing to say about a number.

### Custom messages

Every check that can fail takes one, as a trailing argument:

```ts
JIT.string().min(3, "Name is too short").email({ message: "Invalid email" });
JIT.number().positive("Amount must be positive");
JIT.string().uuid({ version: 4, message: "Expected UUID v4" });
```

Where a check already takes a semantic argument first, a lone string is still
the message: `.time("…")`, `.datetime("…")`, `.digest("sha256", "…")`,
`.format("###-##", "…")`. `.mac()` is the one exception, because its delimiter
is itself a string — its message goes second.

A message is never a callback. A static string plus `issue.params` covers what
translation actually needs, and keeps the diagnostic path free of external
bindings that AOT would have to reconstruct.

**A custom message costs the fast path nothing.** `is()` never reaches for a
message, and a schema carrying long custom messages emits byte-identical
boolean-validation source to one carrying none.

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
- Use `safeParse()` when collecting errors, and branch on `issue.code` rather
  than on `issue.message`.
- Collect-all does more work than fail-fast on invalid input. That is the
  trade you asked for when you asked for diagnostics; `is()` is still there for
  the hot path.
- Avoid callback refinements in AOT declaration files unless they are meant to
  stay runtime-only; callbacks cannot be serialized safely into generated JS.
