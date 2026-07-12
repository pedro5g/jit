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
    return Base.pick("password", "confirmPassword").safeParse(payload.value)
      .success;
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
JIT.string().trim().toLowerCase().min(2).max(64).email().noEmpty();
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

### String Reference

| Operator                             | Semantics                                              | Transform? | Good fit                                      |
| ------------------------------------ | ------------------------------------------------------ | ---------- | --------------------------------------------- |
| `.min(n)` / `.max(n)` / `.length(n)` | UTF-16 string length bounds                            | no         | names, codes, fixed identifiers               |
| `.oneOf(values)`                     | exact allow-list                                       | no         | small domain enums that should remain strings |
| `.startsWith/.endsWith/.includes`    | direct string relation                                 | no         | namespaced IDs and protocol tokens            |
| `.regex(pattern)`                    | custom regular expression                              | no         | a format not covered by built-ins             |
| `.email(pattern?)`                   | default practical email or explicit pattern            | no         | account/contact boundaries                    |
| `.uuid(version?)`, `.guid()`         | UUID/GUID syntax                                       | no         | API identifiers                               |
| `.url()` / `.httpUrl()`              | URL syntax, optionally HTTP(S)-only                    | no         | links and webhooks                            |
| `.trim()`                            | trims output during parse                              | yes        | human form input                              |
| `.lowercase/.uppercase`              | validates existing case                                | no         | canonical-input enforcement                   |
| `.toLowerCase/.toUpperCase`          | converts parsed output                                 | yes        | normalization boundaries                      |
| `.normalize(form)`                   | Unicode normalization                                  | yes        | search keys, user names                       |
| `.noEmpty()`                         | turns `""` into missing input before wrappers/defaults | yes        | HTML forms and query strings                  |
| `.sanitize()`                        | removes script/style markup and escapes angle brackets | yes        | defensive text ingestion                      |
| `.format(mask)`                      | applies a typed `#` digit mask                         | yes        | CPF/CNPJ/phone display values                 |

Format checks also include `cuid`, `cuid2`, `ulid`, `xid`, `ksuid`, `nanoid`,
`emoji`, `ipv4`, `ipv6`, `cidrv4`, `cidrv6`, `mac`, `base64`, `base64url`,
`hostname`, `domain`, `e164`, `hex`, `jwt`, and fixed hash `digest` formats.
ISO date/time methods remain available on string chains for compatibility, but
new code should use `JIT.iso.date/time/datetime/duration`.

Validation-only checks can return the original input reference. Transforming
checks require `parse`/`safeParse` to build the changed output; `is` only answers
whether the input already satisfies the schema.

### Empty Form Values

`.noEmpty()` runs before optional/default guards:

```ts
const Search = JIT.object({
  query: JIT.string().noEmpty().optional(),
  locale: JIT.string().noEmpty().default("pt-BR"),
  required: JIT.string().noEmpty(),
});

Search.parse({ query: "", locale: "", required: "term" });
// { query: undefined, locale: "pt-BR", required: "term" }
```

Use it only when the transport convention defines empty text as missing. An
empty string can be meaningful in patch/document domains and should then stay
a normal string.

### Masks And Documents

```ts
const CPF = JIT.string().cpf().format("###.###.###-##");
const CNPJ = JIT.string().cnpj().format("##.###.###/####-##");
const Phone = JIT.string().phoneBR().format("(##) #####-####");
```

The format pattern is checked by TypeScript: only `#`, spaces and supported
punctuation are accepted, and a pattern without a placeholder is rejected.
Keep storage canonical when possible; apply presentation masks at an explicit
boundary rather than using formatted text as an index key.

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

### Number Reference

| Operator                    | Rule                                      |
| --------------------------- | ----------------------------------------- |
| `.min/.gte(n)`              | `value >= n`                              |
| `.max/.lte(n)`              | `value <= n`                              |
| `.moreThan/.gt(n)`          | `value > n`                               |
| `.lessThan/.lt(n)`          | `value < n`                               |
| `.positive/.negative`       | strict sign, zero rejected                |
| `.nonnegative/.nonpositive` | inclusive zero bound                      |
| `.multipleOf/.step(n)`      | exact numeric step rule                   |
| `.finite()`                 | rejects infinities and NaN                |
| `.safe()`                   | safe integer range                        |
| `.int()`                    | integer                                   |
| `.int32()`                  | signed 32-bit integer                     |
| `.float32()`                | exactly representable as IEEE-754 float32 |
| `.float64()`                | finite IEEE-754 double constraint         |
| `.oneOf(values)`            | exact numeric allow-list                  |

Choose physical numeric checks intentionally. `.int32()` lets binary rowsets
store four bytes instead of eight. `.float32()` can halve analytical memory,
but values are rounded to float32 semantics; money normally needs integer minor
units or a decimal domain type, not float32.

NaN is the reason generated logical negation does not blindly invert every
comparison. JIT preserves JavaScript comparison semantics under `not` instead
of applying unsafe De Morgan rewrites to ordered numeric operators.

## Array And Collection Operators

```ts
const Page = JIT.array(User).min(1).max(100).nonEmpty();
```

`.min`, `.max`, `.length`, and `.nonEmpty` validate collection cardinality.
`JIT.array(ObjectSchema).binary(options)` is a compilation terminal, not a
validation check: it produces a rowset loader for large flat-object batches.

Use `JIT.set`, `JIT.map`, `JIT.record`, and `JIT.tuple` when the runtime
representation matters. JSON boundaries cannot faithfully carry Map/Set;
convert them explicitly or use the binary codec where supported.

## Common Wrappers

| Operator                      | Output meaning                   | Notes                                      |
| ----------------------------- | -------------------------------- | ------------------------------------------ | ------------------------ | ---------------------- |
| `.optional()`                 | `T                               | undefined`                                 | property may be absent   |
| `.required(message?)`         | removes optional/default absence | object form can target fields              |
| `.nullable()`                 | `T                               | null`                                      | does not imply undefined |
| `.nullish()`                  | `T                               | null                                       | undefined`               | nullable plus optional |
| `.default(value/factory)`     | supplies missing output          | literal defaults receive static checks     |
| `.readonly()`                 | readonly inferred output         | does not invent deep cloning               |
| `.promise()`                  | `Promise<T>`                     | enables async validator generation         |
| `.brand(name)`                | nominal type marker              | runtime representation stays unchanged     |
| `.pipe(transform)`            | changes output type              | callback is an external binding            |
| `.refine(predicate, options)` | domain predicate                 | use `when` to avoid noisy dependent errors |
| `.apply(fn)`                  | reusable builder macro           | runs while constructing the schema         |

## Unknown Object Keys

```ts
const Strict = User.strict(); // unknown keys are issues
const Loose = User.loose(); // unknown keys pass through
const Metadata = User.catchall(JIT.string()); // unknown values must be strings
```

Choose this at trust boundaries, not by habit. Strict objects catch API drift;
loose objects are useful for envelopes owned by another service; catchalls
preserve extension points while still validating their values.

## Conditional Validation Strategy

Use `when/where` when one field's schema changes with a sibling. Use
`refine(..., { when })` when the final rule compares multiple already-valid
fields. Use a discriminated union when the condition defines genuinely
different object shapes:

```ts
const Payment = JIT.discriminatedUnion("method", [
  JIT.object({ method: JIT.literal("pix"), key: JIT.string().min(1) }),
  JIT.object({ method: JIT.literal("card"), last4: JIT.string().length(4) }),
]);
```

The union gives TypeScript branch narrowing and lets validators/binary rowsets
dispatch directly. A large web of conditional optional fields usually has
worse types, diagnostics, and generated branches.

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
- Put cheap/selective checks before opaque refinements. The compiler reorders
  safe built-ins, but it cannot reason through arbitrary callbacks.
- Use custom messages for user-facing constraints and stable issue `code`
  values for program logic.
- Prefer native composition over copying schemas; transforms are immutable and
  preserve one source of truth.
