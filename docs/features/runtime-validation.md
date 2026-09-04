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
  path: ["name"],
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
- **`path`** is a readonly sequence of property keys. Object fields remain
  strings and collection positions remain numbers, so consumers never have to
  parse a display string such as `items[2].name` back into structure.

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

For untrusted or very large payloads, cap diagnostic work explicitly:

```ts
const safeParseUser = JIT.validate.safeParse(User, { maxIssues: 100 });
const parseUser = JIT.validate.parse(User, { maxIssues: 100 });
```

The generated traversal stops as soon as issue 100 is emitted; it does not
collect the rest and slice afterward. The default remains collect-all. Async
validation and class/DDD `.validate({ maxIssues })` use the same emitter.

When a Runtime Type is nested in a class or another schema, its boundary
result policy is not executed internally. The compiled validator contributes
the nested path and issues to the outer lazy collector; `result` and `tuple`
cannot leak into the parent or stop independent sibling checks. A nested custom
error is only a deferred candidate for the outer boundary and is constructed
after collection.

### Custom messages

Every check that can fail takes one, as a trailing argument:

```ts
JIT.string().min(3, "Name is too short").email({ message: "Invalid email" });
JIT.number().positive("Amount must be positive");
JIT.string().uuid({ version: 4, message: "Expected UUID v4" });
```

Base type gates follow the same contract. String shorthand and the options
form are equivalent:

```ts
const Name = JIT.string("Name must be text").min(1, "Name is required");
const Count = JIT.number({ message: "Count must be numeric" }).int();
const Payload = JIT.object(
  { name: Name, count: Count },
  { message: "Payload must be an object" }
);
```

Object and common collection factories accept the same optional final
argument. Variadic factories such as `tuple` and `union` use
`.required(message)` to customize their own gate without making a schema
argument ambiguous. This metadata is diagnostic-only: boolean `is()` source
does not contain or allocate messages.

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
Issue arrays, path arrays, messages and parameter objects are created only on
failure; dynamic collection paths are emitted as one array rather than a chain
of intermediate concatenations.
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

## Measured diagnostics cost

`pnpm bench:validate`, Node 22.17.1 on a Ryzen 7 5800H, compares runtime JIT,
standalone AOT and a shape-specific handwritten validator. The harness samples
both elapsed time and heap.

| Five-field diagnostic case | Runtime JIT | JIT AOT | Handwritten | AOT heap/call |
| --- | ---: | ---: | ---: | ---: |
| `safeParse`, one issue | 59.79 ns | 50.41 ns | 62.96 ns | 312 B |
| `safeParse`, five issues | 94.77 ns | 95.14 ns | 80.96 ns | 856 B |
| `parse`, five issues | 7.01 µs | 6.27 µs | — | 1.77 kB |

The handwritten diagnostic hard-codes the same five fields rather than walking
a schema. JIT is faster for one issue and about 18% behind it for five in this
capture; the ceiling changes with how much invalid work is reached. Throwing
`parse` costs more because it constructs an `Error` and stack.

Custom-message and default-message AOT validators were within measurement
noise: 52.06/50.41 ns for one issue and 94.05/95.14 ns for five. Boolean AOT
was 45.96 ns with messages versus 42.55 ns without, confirming that message
literals never enter its emitted source or hot path.

`maxIssues: 2` used about 448 B/call in AOT versus 856 B for all five issues,
but took 185 ns versus 95 ns on this tiny object because terminating arbitrary
nested traversal uses a caught internal sentinel. The option is a memory/DoS
bound for large invalid inputs, not a small-input speed optimization.
