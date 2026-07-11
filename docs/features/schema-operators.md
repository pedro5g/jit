# Schema Operators

Schema operators are fluent transformations and checks over the schema AST.
They are not runtime decorators. The compiler reads them once and emits direct
code for the selected operation.

## Object Shape Operators

```ts
const User = JIT.object({
  id: JIT.number(),
  name: JIT.string().min(2),
  email: JIT.string().email(),
});

const PublicUser = User.pick("id", "name");
const PatchUser = User.partial("name", "email");
const RequiredUser = PatchUser.required("name");
const WithoutEmail = User.omit("email");
```

If `partial()` or `required()` receives no fields, it applies to the whole
object. If fields are passed, only those fields change.

`pick` and `omit` take field names, not `{ field: true }` maps. This keeps the
API consistent and avoids object allocations just to describe static keys.

## Conditional Operators

Use `.refine(..., { when })` for whole-value checks that should run only when
part of the payload is already valid:

```ts
const Base = JIT.object({
  password: JIT.string().min(8),
  confirmPassword: JIT.string().min(8),
});

const Schema = Base.refine((data) => data.password === data.confirmPassword, {
  message: "Passwords do not match",
  path: ["confirmPassword"],
  when(payload) {
    return Base.pick("password", "confirmPassword").safeParse(payload.value).success;
  },
});
```

Use `.when()`/`.where()` for field-level conditional rules:

```ts
const Checkout = JIT.object({
  hasDiscount: JIT.boolean(),
  coupon: JIT.string().when("hasDiscount", {
    is: true,
    then: (schema) => schema.required("coupon is required"),
    otherwise: (schema) => schema.optional(),
  }),
});
```

## Logical Composition

```ts
const Admin = JIT.object({ role: JIT.literal("admin") });
const User = JIT.object({ role: JIT.literal("user") });

const Account = Admin.or(User);
const StrictOne = Admin.xor(User);
const NotAdmin = Admin.not();
const Both = Admin.and(JIT.object({ active: JIT.boolean() }));
```

Generated union and discriminated-union code uses branch-aware checks instead
of generic schema interpretation. For discriminated unions, dispatch can go
directly through the tag value.

## String Operators

```ts
JIT.string()
  .trim()
  .toLowerCase()
  .min(2)
  .max(64)
  .email()
  .noEmpty();
```

Useful checks include:

- `.oneOf([...])`
- `.startsWith(value)`
- `.endsWith(value)`
- `.includes(value)`
- `.regex(pattern)`
- `.httpUrl()`
- `.jwt()`
- `.normalize()`
- `.noEmpty()`

Mask/format helpers cover common real-world strings such as document numbers
and Brazilian phone values. Prefer these helpers over custom callbacks when
you want AOT output, because regexes and static values can be serialized while
arbitrary callbacks cannot.

## Number Operators

```ts
JIT.number()
  .int32()
  .moreThan(0)
  .lessThan(100)
  .step(5)
  .oneOf([5, 10, 15] as const);
```

Aliases such as `.gt`, `.gte`, `.lt`, `.lte`, `.nonnegative`, and
`.nonpositive` compile to direct numeric comparisons.

## Defaults And Strict Typing

Static defaults are part of the schema semantics:

```ts
const User = JIT.object({
  name: JIT.string().min(5).default("guest"),
});
```

Where TypeScript can see literal constraints, the public types try to reject
inconsistent defaults early. Runtime validators still enforce the actual rule
because TypeScript cannot prove every dynamic value.

Structural operations such as equal, hash, clone, diff, update, and stringify
canonicalize static defaults consistently. Optional fields remain optional
unless the schema says otherwise.

## Why Operators Are Fast

Operators are stored as declarative schema metadata. The hot function does not
call `.min()` or `.email()` methods. It receives generated code such as:

```ts
if (typeof value.name !== "string") return false;
if (value.name.length < 2) return false;
if (!emailRegex.test(value.email)) return false;
```

That removes method dispatch, generic check arrays, and schema traversal from
every validation call.

## Why Operators Use Less Memory

Because operators compile to straight-line checks, validation does not need to
allocate per-check closures or intermediate parser nodes. Object transforms
rebuild only the fields that changed. Equality/hash/serialize paths use the
same metadata without materializing a normalized schema at runtime.

## Best Practices

- Prefer built-in operators over callback refinements in AOT declarations.
- Use field-name lists for object transforms: `.pick("id", "name")`.
- Use discriminated unions for tagged data.
- Keep `when` predicates narrow and deterministic.
- Use `.noEmpty()` at input boundaries where empty strings should behave like
  missing values.
