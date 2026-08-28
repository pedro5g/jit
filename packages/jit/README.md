<p align="center">
  <img src="../../jit-logo.png" alt="jit — the compiled data engine" width="420" />
</p>

# jit — the compiled data engine

Describe a data shape **once**, and jit compiles specialized JavaScript for
**every** operation over it: validation, equality, cloning, diffing, hashing,
immutable updates, in-memory queries, DTO mapping, PII masking, XSS
sanitizing, JSON serialization, a versioned binary codec, in-memory binary
rowsets for massive flat-object batches, and progressive streaming validation.

Two execution modes, same generated code:

- **JIT (runtime)** — operations compile on first use via
  `globalThis.Function` and are cached per schema.
- **AOT (build time, Prisma-style)** — `pnpm jit init` writes config and
  `jit generate` writes exactly one self-contained `.js` or directly typed
  `.ts` module, both with **zero runtime engine imports**.
  The final bundle keeps only the generated low-level functions the app uses.

```ts
import { JIT } from "@jit-compiler/jit/runtime";

const User = JIT.object({
  id: JIT.number().int().positive(),
  name: JIT.string().min(2, "name is too short"),
  email: JIT.string().email().pii("mask"),
  role: JIT.union(JIT.literal("admin"), JIT.literal("user")),
  tags: JIT.array(JIT.string()).max(8),
});

type User = JIT.Typeof<typeof User>;

const isUser = JIT.validate.is(User);
const parseUser = JIT.validate.parse(User);
const safeParseUser = JIT.validate.safeParse(User);

isUser(input); // pure boolean guard — compiled specialized code
parseUser(input); // throws JITValidationError with every issue
safeParseUser(input); // { success, data | issues } — no exceptions
```

The primary runtime API is composable. Sources, operators, and sinks form one
immutable execution plan that lowers once at the final callable:

```ts
const PublicUsers = JIT.json
  .parse(JIT.array(User))
  .validate()
  .transform(User, { name: (name) => name.trim() })
  .update({ role: "user" })
  .sanitize()
  .mask()
  .filter((q) => q.eq("role", "user"))
  .select("id", "name", "email")
  .to.json();
```

JSON decoding, schema validation, query, mapping, transform, update, security,
and sink stages lower into one generated execution closure. JSON always uses
native `JSON.parse`; runtime compilation warms a bounded canonical sample for
the declared shape, then specialized validation runs immediately after parsing. Read
[Composable execution pipelines](../../docs/features/composable-execution.md)
for ordering, physical fusion, AOT constraints, and test requirements.

## Why compiled?

Generic libraries interpret your schema on every call — walk the tree, branch
on types, allocate intermediates. jit walks the schema **once, at compile
time**, and emits the exact monomorphic code a performance engineer would
write by hand: static property access only (never `for...in` / `Object.keys`
on known shapes), checks ordered cheapest-first (`typeof` → null → numeric →
length → regex), classic indexed loops, no closures, early returns. Runtime
values (regexes, refinement callbacks, query arguments) travel as external
bindings — never interpolated into source.

Measured on this repo's direct generated-code validation benchmark (mitata,
Node 22.17.1, linux-x64, AMD Ryzen 7 5800H, Typia 12.1.1, captured
2026-08-13 — run
`pnpm bench:validate` for your machine):

| Scenario                           | JIT AOT       | Typia generated | Result    |
| ---------------------------------- | ------------- | --------------- | --------- |
| simple `is`, valid                 | **0.320 ns**  | 0.370 ns        | **1.16x** |
| simple `parse`, valid              | **0.473 ns**  | 0.533 ns        | **1.13x** |
| simple `safeParse`, valid          | **5.64 ns**   | 6.01 ns         | **1.07x** |
| simple `safeParse`, invalid        | **38.88 ns**  | 352.93 ns       | **9.08x** |
| nested constrained `is`, valid     | **39.20 ns**  | 47.96 ns        | **1.22x** |
| nested constrained `parse`, valid  | **38.74 ns**  | 47.86 ns        | **1.24x** |
| nested `safeParse`, valid          | **43.94 ns**  | 53.78 ns        | **1.22x** |
| nested `safeParse`, seven failures | **110.66 ns** | 1.33 µs         | **12.0x** |

The separate `pnpm bench:json` suite keeps native syntax parsing and schema
validation distinct. JIT AOT `JSON.parse + validate` is 237.17 ns versus
239.75 ns for generated Typia `assertParse` on the simple case, 777.87 ns
versus 858.17 ns on the nested case, and 7.14 ms versus 7.38 ms for 10k nested
objects. Parse-only JIT AOT is the direct `JSON.parse` binding.

High-volume flow benchmark (`pnpm bench:flows`) validates 50k unknown
objects, filters/projects admins, and serializes the final JSON:

| Pipeline                             | Avg time    | Heap/op     | vs Zod         |
| ------------------------------------ | ----------- | ----------- | -------------- |
| JIT validate + query + JSON          | **8.89 ms** | **5.42 MB** | **2.53x**      |
| Zod safeParse + filter/map/stringify | 22.53 ms    | 8.58 MB     | baseline       |
| Handwritten fused loop               | 2.02 ms     | 0.69 MB     | not comparable |

Binary rowset benchmark (`pnpm bench:binary`) converts flat object batches to
fixed-width `ArrayBuffer` rows and runs byte-offset queries. Numbers below
were captured on the same machine as the table above.

| Scenario                           | JIT binary                  | Baseline                                          | Result                          |
| ---------------------------------- | --------------------------- | ------------------------------------------------- | ------------------------------- |
| Preloaded selective projection, 1M | **columnar 15.04 ms**       | JIT query over JS array 17.86 ms                  | **1.19x faster**                |
| Filtered `count`, 1M               | **columnar 1.09 ms / 96 B** | JIT query over JS array 4.24 ms / 96 B            | **3.88x faster**                |
| Filtered `sum`, 1M                 | **columnar 1.26 ms / 96 B** | JIT query over JS array 4.45 ms / 96 B            | **3.53x faster**                |
| Adaptive `load+query`, 1M, dynamic | **52.67 ms / 28.26 MB**     | Zod 4 parse + native filter 454.89 ms / 110.31 MB | **8.64x faster, 74% less heap** |
| Tagged-union `count`, 1M           | **0.78 ms**                 | Native JS string discriminator 2.64 ms            | **3.40x faster**                |

For one-off queries over already materialized JS arrays, regular `JIT.cqrs.query`
can still be the right tool. Binary rowsets are for reuse, repeated filters,
controlled scratch memory, and pipelines where rows stay compact between
processing stages. `memoryLayout: "auto"` keeps mixed schemas packed and uses
typed views when already naturally aligned. Use `"columnar"` for batches that
feed repeated scans/aggregates; it keeps fields contiguous in the same single
buffer and emits `columnBase + i` hot loops. `JIT.process()` also samples
projection-only strings, skipping high-cardinality maps while preserving
integer dictionaries for every string used in a filter.

High-load validation benchmark (`pnpm bench:load`) preallocates 10k/100k
unknown users and measures only validation work. TypeBox is measured through
both `TypeCompiler.Check` (compiled) and `Value.Check` (dynamic); typia uses
generated `createIs<TypiaUser[]>()` / `createValidate<TypiaUser[]>()`.

| Scenario                            | JIT avg / heap          | TypeBox compiled      | typia generated      | Zod 4                |
| ----------------------------------- | ----------------------- | --------------------- | -------------------- | -------------------- |
| `is()` valid users 10k              | **542.45 µs / 1.43 KB** | 751.53 µs / 774.69 KB | 661.98 µs / 152 B    | 9.76 ms / 4.16 MB    |
| `is()` valid users 100k             | **7.01 ms / 96 B**      | 7.22 ms / 5.34 MB     | 7.17 ms / 152 B      | 114.15 ms / 21.14 MB |
| `is()` invalid tail users 100k      | **7.06 ms / 96 B**      | 7.37 ms / 5.34 MB     | 7.34 ms / 560 B      | 111.58 ms / 20.98 MB |
| `safeParse` valid users 10k         | **567.17 µs / 1.73 KB** | 655.54 µs / 560.25 KB | 793.31 µs / 263.75 B | 11.24 ms / 6.21 MB   |
| `safeParse` invalid tail users 100k | **6.37 ms / 1.95 KB**   | 300.24 ms / 4.64 MB   | 27.76 ms / 5.46 MB   | 111.38 ms / 21.01 MB |

The dynamic TypeBox path (`Value.Check`) is intentionally included in the raw
suite because TypeBox documents both dynamic and compiled validation modes:
on the 100k valid-user load it measured 76.61 ms / 11.74 MB, so the compiled
JIT validator was 10.9x faster while staying effectively allocation-free.

Selected operation load benchmarks from `pnpm bench:all`:

| Operation                           | JIT avg / heap         | Fast competitor       | Competitor avg / heap | Speedup |
| ----------------------------------- | ---------------------- | --------------------- | --------------------- | ------- |
| Equal, array 100k                   | **734.37 µs / 96 b**   | fast-deep-equal       | 9.58 ms / 12.21 MB    | 13.0x   |
| Diff, nested arrays                 | **297.31 µs / 1 KB**   | microdiff             | 7.66 ms / 7.87 MB     | 25.8x   |
| Update, deep object                 | **18.41 ns / 120 b**   | immer                 | 2.22 µs / 3.49 KB     | 120.6x  |
| JSON stringify, medium user         | **207.49 ns / 875 b**  | fast-json-stringify   | 266.52 ns / 1.00 KB   | 1.3x    |
| Stream reject early, bad item 3/10k | **18.89 µs / 24.5 KB** | JSON.parse + validate | 1.96 ms / 921.8 KB    | 103.8x  |

## Install

```sh
pnpm add @jit-compiler/jit
```

JSR keeps the shorter registry-native identity:

```sh
deno add jsr:@jit/compiler
```

```ts
import { JIT } from "jsr:@jit/compiler/runtime";
```

## New in 2.0.0

Every capability is reached through exactly one path — `JIT.validate.*`,
`JIT.compare.*`, `JIT.security.*`, `JIT.json.*`, `JIT.binary.*` — and an
aggregate is a plain object of artifacts, which is also what grouped AOT
generation reads. See the [migration guide](https://jit-site.vercel.app/docs/guides/migrating-to-2)
for a direct replacement for every removed facade.

A self-referencing schema now compiles everywhere. Each cycle participant is
lifted into one named function instead of being inlined, in the validator and
in clone, equal, diff, update, serialize, mask, sanitize, and the binary
codec:

```ts
const Category = JIT.object({
  name: JIT.string(),
  children: JIT.array(JIT.lazy(() => Category)),
});

const isCategory = JIT.validate.is(Category);
const cloneCategory = JIT.clone(Category);
```

`JIT.jsonSchema` is a two-way bridge, so a contract keeps one source of truth
whichever side it starts on. `from` types the schema off the document literal,
and AOT resolves the whole conversion at generation time:

```ts
JIT.jsonSchema.to(User, { target: "openapi-3.0", io: "input" });

const Contract = JIT.jsonSchema.from({
  type: "object",
  properties: { name: { type: "string" }, age: { type: "number" } },
  required: ["name", "age"],
} as const);
```

Every compiled validation artifact implements Standard Schema through
`~standard`, `JIT.ops` declares transformations as data so they survive ahead
of time, and `JIT.mock` generates seeded values that satisfy the schema's own
checks:

```ts
const Handle = JIT.string()
  .min(3)
  .pipe(JIT.ops.trim().lowercase().slice(0, 20));
const sample = JIT.mock(User)();
```

Sanitization policies are compiled into the same specialized transform pass as
parsing. Presets cover plain text, escaped HTML, SQL identifiers and path
segments; an explicit policy can allow a small formatting vocabulary:

```ts
const Comment = JIT.object({
  title: JIT.string().sanitize("text"),
  body: JIT.string().sanitize({
    preset: "none",
    html: { mode: "allow", tags: ["p", "strong", "code"] },
    controls: "remove",
    normalize: "NFC",
    trim: true,
    maxLength: 4_000,
  }),
});
```

Immutable updates can also own reactive state without proxies. Typed path
watchers read only their selected value, and a batch emits one notification:

```ts
const state = JIT.update(User).reactive(initialUser, {
  schedule: "microtask",
});

const stop = state.watch(["profile", "name"], ({ previous, value }) => {
  renderName(value, previous);
});

state.batch((current) => {
  current.update({ active: true });
  current.update({ profile: { name: "Ada" } });
});

stop();
state.dispose();
```

Callable artifacts support explicit aggregation. The same object controls
grouped AOT generation, so unused functions do not enter the emitted module or
final bundle. DTO remains an ordinary annotated schema:

```ts
const ReadUser = {
  is: JIT.validate.is(User),
  parse: JIT.validate.parse(User),
  equal: JIT.compare.equal(User),
};

const CreateUserDTO = JIT.dto(CreateUserSchema);
const PublicUserDTO = JIT.dto(PublicUserSchema);
const parseCreateUser = JIT.json.parse(CreateUserDTO).validate();
const toPublicUsers = JIT.map.many(UserEntity, PublicUserDTO, {
  name: { from: "fullName" },
});
```

The browser playground includes executable `sanitize`, `reactiveUpdate`,
`dto`, `compile`, and `indexes` scenarios. The last one contrasts `.entity()`,
`.indexBy()`, schema `.keyed()`, and query `.keyed()` side by side.

---

## Schemas

zod-like builders; every schema carries its resolved output type.
`JIT.Typeof<typeof X>` is the only public type helper and works on builders
and raw schemas.

```ts
// primitives
JIT.string()  JIT.number()  JIT.int()  JIT.boolean()  JIT.bigint()
JIT.date()    JIT.literal("click")
JIT.enum({ A: "a", B: "b" })  JIT.enum(["admin", "user"])
JIT.null()    JIT.undefined()  JIT.any()  JIT.unknown()  JIT.never()

// collections
JIT.array(T)  JIT.set(T)  JIT.mapSchema(K, V)  JIT.record(K, V)
JIT.tuple(A, B)  JIT.object({ ... })

// composition
JIT.union(A, B, C)                       // variadic
JIT.xor(A, B)                            // exactly one option must match
JIT.not(A)                               // reject values matching A
JIT.discriminatedUnion("kind", [A, B])   // tagged, O(1) dispatch
JIT.intersection(A, B)

// wrappers (chainable on any builder)
.optional() .nullable() .nullish() .readonly() .promise()
.default(value | () => value) .brand("UserId")
.refine((v) => v.ok, "custom message") .pipe((v) => transform(v))
.or(Other) .and(Other) .xor(Other) .not()
```

Objects are mutable by default for normal TypeScript ergonomics. Use
`.readonly()` when the parsed output must be frozen at the root.

### Advanced schemas

```ts
JIT.json.value(); // any JSON-encodable value
JIT.custom<Decimal>((value) => Decimal.isDecimal(value), "expected Decimal");
JIT.templateLiteral(["hello, ", JIT.string(), "!"] as const);
// inferred type: `hello, ${string}!`

const MyFunction = JIT.function({
  input: [JIT.string()],
  output: JIT.number(),
});

const computeTrimmedLength = MyFunction.implement((input) => {
  return input.trim().length;
});

const computeTrimmedLengthAsync = MyFunction.implementAsync(async (input) => {
  return input.trim().length;
});
```

Every builder supports `.apply()` for reusable schema decorators:

```ts
function commonNumberChecks<T extends ReturnType<typeof JIT.number>>(
  schema: T,
) {
  return schema.min(0).max(100);
}

const Percent = JIT.number().apply(commonNumberChecks).nullable();
```

Temporal validates the native `globalThis.Temporal` objects. Tests use
`@js-temporal/polyfill`; production code can bring the same polyfill or run
on a runtime with Temporal enabled.

```ts
JIT.temporal.instant();
JIT.temporal.plainDate();
JIT.temporal.plainTime();
JIT.temporal.plainDateTime();
JIT.temporal.zonedDateTime();
JIT.temporal.plainYearMonth();
JIT.temporal.plainMonthDay();
JIT.temporal.duration();

JIT.temporal
  .plainDate()
  .between("2026-07-01", "2026-07-31")
  .daysOfWeek([1, 2, 3, 4, 5]) // ISO: Mon=1 ... Sun=7
  .monthsOfYear([7]);

JIT.temporal.plainTime().min("09:00:00").max("18:00:00").truncateTo("minute");
JIT.date().min("2026-01-01").max("2026-12-31").truncateTo("second");
```

ISO text is a separate namespace and always infers `string`:

```ts
JIT.iso.date(); // strict YYYY-MM-DD with calendar/leap-year validation
JIT.iso.time({ precision: -1 }); // exact HH:MM
JIT.iso.time({ precision: 3 }); // exact HH:MM:SS.sss
JIT.iso.datetime(); // requires Z
JIT.iso.datetime({ offset: true }); // also accepts +/-HH:MM
JIT.iso.datetime({ local: true }); // also accepts no zone
JIT.iso.duration(); // ISO 8601-1 duration
```

Use `JIT.iso.*` for transport strings, `JIT.date()` for actual native Date
objects, and `JIT.temporal.*` when calendar/time-zone semantics must be explicit.
The legacy `JIT.string().date/time/datetime/duration` chains remain compatible
and compile to the same checks.

Value codecs are bidirectional transforms, separate from the binary wire
codec:

```ts
const stringToDate = JIT.codec(JIT.iso.datetime(), JIT.date(), {
  decode: (iso) => new Date(iso),
  encode: (date) => date.toISOString(),
});

stringToDate.decode("2026-07-10T00:00:00.000Z"); // Date
stringToDate.encode(new Date("2026-07-10T00:00:00.000Z")); // ISO string
```

### Checks and custom messages

Every failing check accepts a custom message as its last argument:

```ts
JIT.string()
  .min(2, "too short")
  .max(64)
  .startsWith("user:")
  .includes(":active:")
  .endsWith(":v1")
  .oneOf(["admin", "user"] as const)
  .noEmpty()
  .regex(/^[a-z]+$/, "lowercase only");
JIT.number().gt(0).lt(100).step(0.5).int32("must fit signed int32").float64();
JIT.array(JIT.string()).nonEmpty("pick at least one tag");
JIT.date().between("2026-01-01", "2026-12-31");
```

Literal defaults are checked against static constraints when TypeScript can see
the literal:

```ts
JIT.string().min(5).max(10).default("hello"); // ok
JIT.string()
  .oneOf(["admin", "user"] as const)
  .default("admin"); // ok

JIT.string().min(5).default("oi"); // TS error
JIT.number().max(10).default(11); // TS error
```

`refine` supports zod/yup-style conditional execution and issue paths:

```ts
const Credentials = JIT.object({
  password: JIT.string().min(8),
  confirmPassword: JIT.string().min(8),
});

const Signup = Credentials.refine(
  (value) => value.password === value.confirmPassword,
  {
    message: "Passwords do not match",
    path: ["confirmPassword"],
    when(payload) {
      return Credentials.safeParse(payload.value).success;
    },
  },
);
```

Field-level conditionals use sibling values. `where` and `when` are aliases;
the selected branch is still compiled into direct specialized validation:

```ts
const Checkout = JIT.object({
  temDesconto: JIT.boolean(),
  cupom: JIT.string().where("temDesconto", {
    is: true,
    then: (schema) => schema.required("O cupom é obrigatório").min(3),
    otherwise: (schema) => schema.optional(),
  }),
});
```

### String formats

All formats compile to a single inlined regex test. The full regex library is
public as `JIT.regexes` — reuse it or override the defaults:

```ts
JIT.string().email(); // practical default
JIT.string().email(JIT.regexes.rfc5322Email); // override the pattern
JIT.string().uuid(7); // RFC 9562, pinned version
JIT.string().cuid2().ulid().nanoid().ksuid().xid();
JIT.string().ipv4().ipv6().cidrv4().mac("-");
JIT.string().base64().base64url().hex();
JIT.string().hostname().domain().e164();
JIT.string().httpUrl().jwt();
JIT.iso.date(); // YYYY-MM-DD, calendar-valid
JIT.iso.time({ precision: 0 }); // HH:MM:SS
JIT.iso.datetime({ offset: true }); // ISO datetime, allows ±HH:MM
JIT.iso.duration();

// Legacy string chains remain aliases for the same compiled checks.
JIT.string().datetime({ offset: true });
JIT.string().digest("sha256", "base64url"); // md5..sha512 digests
JIT.string().stringFormat("slug", /^[a-z0-9]+(?:-[a-z0-9]+)*$/);
```

### String masks

Masks are parse-time transforms. They strip non-digits by default and then
emit direct low-level string assembly in generated code. Boolean `is()`
validators omit that assembly because it cannot change the validation result:

```ts
const Contact = JIT.object({
  cpf: JIT.string().cpf(), // "12345678901" -> "123.456.789-01"
  cnpj: JIT.string().cnpj(),
  phone: JIT.string().phoneBR(), // "(11) 98765-4321"
  code: JIT.string().format("##-##"),
});

const StrictCode = JIT.string().format("##-##", { mode: "strict" });
StrictCode.is("12-34"); // true: literals and digit positions already match
StrictCode.is("1234"); // false

const formatCode = JIT.format(JIT.string().format("##-##"));
formatCode("1234"); // "12-34" without compiling/shipping a validator
```

Literal mask patterns are type-checked: they must include at least one `#`
placeholder and only use supported mask characters. The dedicated formatter
can also be exported from `*.jit.ts` as a standalone AOT function or grouped
with `{ format: formatCode }`.

### Coercion (zod-style)

`JIT.coerce.*` marks the base schema — checks chain naturally, and the
conversion is emitted **inline** (`Number(v)`, `new Date(v)`, ...), so
coerced validators survive AOT generation:

```ts
const Query = JIT.object({
  page: JIT.coerce.number().int().positive(), // "3"  → 3
  active: JIT.coerce.boolean(), // 1    → true
  since: JIT.coerce.date(), // ISO  → Date
});

// custom callback form (runtime-only):
JIT.coerce(JIT.string(), (v) => String(v).toUpperCase());
```

### Data annotations

```ts
JIT.string().pii("mask")       // for JIT.security.mask: "redact" | "mask" | "hash"
JIT.string().sanitize()        // executable HTML removed, fused into parse
JIT.string().sanitize("htmlEscape")
JIT.string().sanitize("sqlIdentifier") // identifiers only; bind SQL values
JIT.array(User).entity({ key: "id" }).indexBy("id")   // strategy hints
JIT.object({...}).hash("ordered")                      // equal short-circuit
```

### Object algebra

```ts
Base.pick("id", "name")  Base.omit("secret")
Base.partial()           // every field optional
Base.partial("name")     // only selected fields optional
Base.required()          // every optional field required again
Base.required("name")    // only selected fields required again
Base.extend({ tag: JIT.string() })  Base.merge(Other)

const Strict = Base.strict(); // reject unknown keys
const Loose = Base.loose(); // preserve unknown keys
const WithFlags = Base.catchall(JIT.boolean()); // validate/transform extras
const BaseKeys = Base.keyof(); // enum of known object keys
```

---

## Validation

```ts
const isUser = JIT.validate.is(User);
const parseUser = JIT.validate.parse(User);

isUser(x); // (x: unknown) => x is User
parseUser(x); // User or throws JITValidationError

isUser.source; // generated source, useful for debugging
isUser.hash; // deterministic source hash
isUser.explain(); // { operation, hash, source, cache }
```

Every validation operation is an independent callable artifact:

```ts
const isUser = JIT.validate.is(User);
const safeParseUser = JIT.validate.safeParse(User);
const parseUser = JIT.validate.parse(User);

isUser(x); // (x: unknown) => x is User — zero allocation
safeParseUser(x); // { success: true, data } | { success: false, issues }
parseUser(x); // data or throws JITValidationError

// async: settles promise wrappers, then validates the resolved value
const Job = JIT.object({ result: JIT.string().min(3).promise() });
await JIT.validate.async.parse(Job)({ result: fetchResult() });
```

Validators can be compiled selectively. The compiler emits only the requested
surface plus the minimum shared internals needed by that surface:

```ts
const Selected = {
  is: JIT.validate.is(User),
  parse: JIT.validate.parse(User),
};
Selected.is(input);
Selected.parse(input);
Selected.safeParse; // ✗ not compiled

const { is, parse } = Selected;
```

Builders expose the same validator conveniences for local checks and
conditional refinements:

```ts
User.is(input);
User.safeParse(input);
User.parse(input);
```

For framework interop, every builder exposes an optional Standard Schema v1
facade. It is cached per schema and closes over the compiled `safeParse`
function, so validation still runs through specialized generated code. The
facade is never stored in the AST, so AOT output is unchanged unless you
explicitly use it at runtime:

```ts
const standard = User["~standard"];
standard.version; // 1
standard.vendor; // "jit"
standard.validate(input); // { value } | { issues }
```

Issues are consumable vectors — path, machine code, expectation, message:

```ts
[
  { path: "profile.age", code: "too_big", expected: "<= 150", message: "..." },
  {
    path: "items[2].sku",
    code: "expected_string",
    expected: "string",
    received: "number",
    message: "...",
  },
];
```

Unions validate **deeply** (inner checks and refinements run per option);
discriminated unions dispatch on the tag in O(1). `parse` applies defaults,
coercions, trims/case mutations, and transforms in the same pass — and
returns the input **by reference** when nothing changes.

---

## Data operations

```ts
const equalUser = JIT.compare.equal(schema);
const cloneUser = JIT.clone(schema);
const diffUser = JIT.compare.diff(schema);
const hashUser = JIT.compare.hash(schema);
const updateUser = JIT.update(schema);
const stringifyUser = JIT.json.stringify(schema);
const parseUserJson = JIT.json.parse(schema).validate();
const maskUser = JIT.security.mask(schema);
const sanitizeUser = JIT.security.sanitize(schema);
const userCodec = JIT.binary.codec(schema);
```

Each operation artifact is the compiled function itself — nothing to unwrap:

```ts
const equalUser = JIT.compare.equal(User);
const cloneUser = JIT.clone(User);
const diffUser = JIT.compare.diff(User);
const hashUser = JIT.compare.hash(User);

equalUser(a, b);
```

Structural operations understand the same complex shape semantics as the
validator. Selected object fields made optional by `.partial("id")` compare
and update as optional values; static `.default(value)` fields are
canonicalized by `equal`, `hash`, `clone`, `diff`, `update`, and
`stringify`; and unions/discriminated unions dispatch by branch in generated
code. A diff between two values in the same branch is deep; a branch change is
a root update for that branch.

Parameterized updates follow the same compile shape:

```ts
const renameUser = JIT.update(User)
  .patch({ name: JIT.cqrs.param("name") })
  .compile();

renameUser(user, { name: "Grace" });
```

### Watched collections

Use `JIT.watch` for a compiled, stateless diff between immutable collection
snapshots. A stable object key gives O(n) additions, removals and
reference-level updates:

```ts
const Users = JIT.array(UserSchema);
const watchUsers = JIT.watch(Users, { key: "id" });

const changes = watchUsers(previousUsers, currentUsers);
changes.newItems;
changes.removedItems;
changes.updatedItems;
changes.isChanged;
```

Use `JIT.watchedList` when an aggregate owns an evolving list. The keyed form
maintains identity indexes and tracks canceled additions/removals:

```ts
const members = JIT.watchedList(Users, previousUsers, { key: "id" });

members.add(newUser);
members.remove(oldUser);
members.snapshot();
```

Schemas provide types here; they do not validate inserted values. Validate
untrusted input first. Callback-free `JIT.watch` functions can be exported
standalone from `*.jit.ts` or gathered in an artifact object; the AOT result has no
runtime compiler import. Stateful watched-list instances remain runtime-owned.

## Query DSL

Fused single-loop pipelines over collections — no intermediate arrays:

```ts
const admins = JIT.cqrs
  .query(UserList)
  .params({ minimumId: JIT.int() })
  .filter((q, params) =>
    q.and(q.not(q.eq("role", "blocked")), q.gt("id", params.minimumId)),
  )
  .select("id", "name", "role")
  .unique("id")
  .orderBy("name", "asc");

admins(users, { minimumId: 100 }); // one pass, params read directly

// build-time constants are baked into the query artifact:
JIT.cqrs.query(UserList).filter((q) => q.eq("role", JIT.cqrs.const("admin")));

// terminals
JIT.cqrs
  .query(UserList)
  .filter((q) => q.eq("role", "user"))
  .avg("id");
// sum / count / avg / min / max — empty: sum/count → 0, others → undefined

// keyed collections, grouping, and mutations
JIT.cqrs.query(UserList).groupBy("role");
JIT.cqrs
  .query(UserList)
  .filter((q) => q.lt("score", 0))
  .delete();
JIT.cqrs
  .query(UserList)
  .filter((q) => q.eq("id", 7))
  .update({ active: false });
```

### Lazy iterators and visitors

The eager array remains the default. Choose an explicit incremental terminal
when the consumer should control materialization:

```ts
const activeNames = JIT.cqrs
  .query(UserList)
  .filter((q) => q.eq("active", true))
  .select("id", "name")
  .take(10);

activeNames(users); // eager array — the builder is the query
activeNames.to.iterator(); // IterableIterator<{ id, name }>
activeNames.to.asyncIterator(); // AsyncGenerator, accepts cursors/streams
activeNames.to.visitor(); // (input, consume) => emitted count
activeNames.lazy(); // generator-first builder
```

Incremental operators include `flatMap`, `take`, `takeWhile`, `drop`,
`dropWhile`, `unique`, `chunk`, `window`, `pairwise`, `scan`, and
`groupAdjacentBy`. Consecutive filter/projection/control operators are fused
into one generated stage. `orderBy` is supported but reported as a
materialization barrier by `.explain("generator")`.

On the one-million-row lazy benchmark, a direct `.to.visitor()` consumed
800k projected matches in **3.81 ms / 760 B heap**, versus **15.21 ms / 7.75
MiB** for a handwritten generator. See
[`docs/features/lazy-execution.md`](../../docs/features/lazy-execution.md).

## Transform

Compiled object transforms can select fields and use built-in field operators
without shipping the schema engine:

```ts
const toUserDTO = JIT.transform(User)
  .select("id", "name")
  .map("name", (field) => field.lowercase())
  .compile();

toUserDTO({ id: 1, name: "ADA", role: "admin" });
// { id: 1, name: "ada" }
```

## DTO mapper

Whitelist by construction — only target-schema fields can exist in the
output, so accidental `passwordHash` leaks are impossible:

```ts
// Every target field matches by name and type: nothing else to say.
const toPublicUser = JIT.map(User, PublicUser);

// Overrides appear in the signature only when a field cannot be inferred.
const toDTO = JIT.map(UserEntity, PublicUser, {
  name: { from: "fullName" }, // rename
  label: (user) => `${user.name}#${user.id}`, // computed
});
const toManyDTOs = JIT.map.many(UserEntity, PublicUser, {
  name: { from: "fullName" },
  label: (user) => `${user.name}#${user.id}`,
});

toDTO(entity);
toManyDTOs(entities); // fused indexed loop over the list
```

The third argument is typed against the target: it is required only while a
required target field has no compatible same-name source field, and the error
names exactly those fields. `Map` **schemas** are a different thing and live on
`JIT.mapSchema(key, value)`.

Selection is physical code generation, not an object projection after compile:
`JIT.map` emits no bulk loop, while `JIT.map.many` emits only the fused indexed
loop. Artifact creation remains lazy and compiles that
single operation on first use.

## JSON Schema and fixtures

Two descriptive operations share the same schema, so neither can drift from
what the validator enforces:

```ts
// The interchange document OpenAPI, form builders and structured-output
// APIs consume — static data, inlined as a literal by AOT.
const userDocument = JIT.jsonSchema.to(User);
const openapi = JIT.jsonSchema.to(User, { target: "openapi-3.0", io: "input" });

// A generator whose values pass `JIT.validate.is(User)` by construction.
const mockUser = JIT.mock(User);

mockUser({ seed: 7 }); // reproducible fixture
```

The bridge also runs the other way. A document is a contract that already
states its shape, so the type is read from the literal instead of declared
twice:

```ts
const Order = JIT.jsonSchema.from({
  type: "object",
  properties: { id: { type: "integer", minimum: 1 }, sku: { type: "string" } },
  required: ["id", "sku"],
} as const);

const isOrder = JIT.validate.is(Order);
// (value: unknown) => value is { id: number; sku: string }
```

`minimum` and friends become the same specialized checks a hand-written schema
compiles, and in AOT the whole conversion happens at generation time — the
generated module carries the functions, never the document.

A type is representable exactly when JIT's own JSON serializer defines a wire
form for it: `JIT.date()` is a `date-time` string because that is what
`JIT.json.stringify` writes, while `Map`, `Set` and `bigint` go through the
`unsupported` policy instead of being approximated. See the
[JSON Schema bridge guide](../../docs/features/json-schema.md) for targets,
`refine` and `override`.

`mock` honors string lengths/affixes/formats, numeric bounds and multiples,
array lengths, enum members, optional presence and union branches; its PRNG
core is inlined so generated modules stay import-free.

## Declared transformations

`.pipe()` takes a callback or a `JIT.ops` chain. Both run after validation, on
the validated value:

```ts
const Handle = JIT.string()
  .min(3)
  .pipe(JIT.ops.trim().lowercase().slice(0, 20));
const Price = JIT.number().pipe(JIT.ops.clamp(0, 1000).toFixed(2));
```

A chain is data, so it is written into the generated function as source
(`o = o.trim().toLowerCase()`) instead of a call to a bound closure.

This is **not** a runtime speed win — a monomorphic callback is inlined by the
engine, and the two forms measure the same. What it buys is ahead-of-time
coverage: a callback that closes over its scope cannot be serialized, so
`jit generate` skips the artifact entirely. A chain always generates.

## Security

```ts
const mask = JIT.security.mask(User); // .pii() fields → "***" / last-4 / FNV hash
logger.info(mask(user)); // LGPD/GDPR-safe structured logs

const clean = JIT.security.sanitize(Form); // applies each field's compiled policy
```

Both are surgical: only paths containing marked fields are rebuilt, untouched
subtrees are shared by reference. Sanitization also runs **inside**
`parse`/`safeParse` for `.sanitize()` fields perform validation and cleanup in
one pass. `sqlIdentifier` only cleans an identifier; always bind SQL values
through prepared parameters.

## Serialization

### JSON

```ts
const stringifyUser = JIT.json.stringify(User);
const parseUserJson = JIT.json.parse(User).validate();

stringifyUser(user); // static keys baked in; escape fast path
parseUserJson(body); // native JSON.parse + specialized validation

const stringifyChunks = JIT.json.stringifyChunks(UserList, {
  chunkBytes: 16 * 1024,
});

for (const chunk of stringifyChunks(users)) writable.write(chunk);
```

Validation issues can also be consumed through an iterator:

```ts
const issues = JIT.validate.issues(User);
for (const issue of issues(input)) log(issue);
```

### Binary codec (wire format v2)

Schema-driven binary layout — both sides share the schema, so the wire
carries **no field names**:

```ts
const codec = JIT.codec(Event, { version: 2 });

socket.send(codec.encode(event)); // one sizing pass, one allocation
const n = codec.encodeInto(event, scratch); // straight into your buffer
const event = codec.decode(message.data); // exact reconstruction
```

- byte 0 = schema version — decoding under a drifted schema **fails loudly**
- `int` schemas → guarded int32 (overflow throws, never corrupts);
  `bigint` → int64; numbers/dates → float64 LE
- strings → u32 length + UTF-8 via `TextEncoder.encodeInto`
- object optionals → 2-bit bitmask block (absent/null/present), 4 fields/byte
- unions → 1 tag byte; discriminated unions dispatch on the literal (0 bytes);
  intersections encode field-by-field
- arrays/sets/maps/records → u32 count + entries; `any`/`unknown` rejected

### Streaming validation

Progressive validation while the payload is still arriving; an internal
boundary FSM survives tokens cut anywhere — mid-string, mid-number, even
mid-UTF-8:

```ts
const stream = JIT.stream(JIT.array(Event), {
  onItem: (event) => queue.push(event), // validated element-by-element
});

socket.on("data", (chunk) => stream.write(chunk)); // throws on first bad item
socket.on("end", () => stream.end());

JIT.stream(Event, { format: "ndjson", onItem }); // one document per line
```

---

## Artifact objects

An artifact is a plain value, so grouping them is a plain object. Only those
properties exist at runtime, in types, and in AOT output. This is the shape to
use when you want `User.is()` style imports.

```ts
const UserSchema = JIT.object({
  id: JIT.number(),
  name: JIT.string(),
  role: JIT.union(JIT.literal("admin"), JIT.literal("user")),
});

export const User = {
  is: JIT.validate.is(UserSchema),
  parse: JIT.validate.parse(UserSchema),
  findAdmins: JIT.cqrs.query(UserList).filter((q) => q.eq("role", "admin")),
  toDTO: JIT.map.many(UserSchema, PublicUser, {}),
};

User.is(input);
User.findAdmins(users); // your query, no prefixes, fully typed
User.toDTO(users);
User.clone(x); // ✗ does not exist — never declared, never compiled
```

## AOT — `jit generate`

Create the config in the project root:

```sh
pnpm jit init
pnpm jit doctor
pnpm jit list
pnpm jit generate
```

Generated `jit.config.ts`:

```ts
import { AOT } from "@jit-compiler/jit";

export default AOT.defineConfig({
  /** Files, directories, or globs holding your JIT declarations. */
  entries: ["./jit/**/*.jit.ts"],
  output: {
    /** Destination relative to this config file. */
    directory: "generated",
    /** "ts" emits typed source; "js" emits ready-to-run ESM. */
    format: "ts",
  },
});
```

Discovery rules are intentionally boring:

- if `entries` is omitted, `jit generate` scans from the project root;
- `entries` accepts files, directories, and globs like `jit/**/*.jit.ts`;
- `patterns` controls directory scans; the default matches `**/*.jit.ts` and
  `**/*.jit.js`;
- if no artifacts are declared, the CLI prints a warning and writes nothing;
- `jit doctor` prints resolved config, output directory, patterns, and files;
- `jit list` loads declaration files and prints declared types, artifact
  objects and standalone artifacts without writing anything;
- `jit inspect <export> --stage plan|source` shows the collected descriptor or
  exact generated source for review;
- `jit clean` removes the configured generated directory.

The declaration file is the manifest, read literally: a schema names a
generated type, an artifact becomes a generated function under its own binding
name, and an object of artifacts becomes one frozen object. `export` is
optional; a schema alone never becomes a runtime function.

```ts
// jit/user.jit.ts — discovered by convention (**/*.jit.ts)
import { JIT } from "@jit-compiler/jit/define";

// Private to the file, but it still names the generated `User` type.
const User = JIT.object({
  id: JIT.number(),
  name: JIT.string(),
  role: JIT.string(),
});

// Keeps its binding name exactly.
export const isUser = JIT.validate.is(User);

// One frozen object: UserOps.parse, UserOps.findAdmins.
export const UserOps = {
  parse: JIT.validate.parse(User),
  findAdmins: JIT.cqrs
    .query(JIT.array(User))
    .filter((q) => q.eq("role", "admin")),
};
```

```ts
import { isUser, type User, UserOps } from "./generated/index.js";

isUser(input);
const user: User = UserOps.parse(input);
UserOps.findAdmins(users);
```

Run generation:

```sh
pnpm jit generate
pnpm jit generate src/user.jit.ts --out generated --name @acme/models
pnpm jit generate --pattern "src/schemas/**/*.ts"
pnpm jit generate --watch
pnpm jit list
pnpm jit inspect isUser --stage source
pnpm jit clean
```

Generation writes one self-contained module, or one per declaration file plus
a barrel when `output.perFile` is on:

```text
generated/            generated/          (perFile: true)
└── index.ts          ├── index.ts
                      ├── user.ts
                      └── order.ts
```

With `output.perFile`, each declaration file is compiled as an independent,
self-contained module that does not import or initialize the generated barrel.

Every layout is **fully self-contained**:
compiled functions, tiny error class, hash/index helpers, and codec helpers
are inlined. There is no `import "jit"` in generated runtime code, so the
final app bundle carries only the low-level specialized functions it imports.

Source-first TypeScript is the CLI/config default. The generator writes one
executable and typed `index.ts`, plus one `.ts` module per declaration file
when `output.perFile` is on:

```ts
import { AOT } from "@jit-compiler/jit";

export default AOT.defineConfig({
  entries: ["jit/**/*.jit.ts"],
  output: {
    directory: "src/generated/jit",
    format: "ts",
  },
});
```

```ts
import { UserOps } from "./generated/jit/index.js";

UserOps.is(input);
```

The `.js` import specifier is intentional for ESM and `NodeNext`: TypeScript
resolves it to `index.ts` during development and emits a valid JavaScript
specifier. Direct TypeScript output has no parallel declaration file that can
drift from the implementation.

Schema and execution-plan types are structural in TypeScript output:

```ts
export type User = {
  id: number;
  name: string;
  role: "admin" | "member";
};
const UserOps: {
  readonly is: (value: unknown) => value is User;
  readonly parse: (value: unknown) => User;
};
```

Use `output.format: "js"` for one ready-to-run ESM `.js` file without
declaration overhead. Use `"ts"` for the same specialized functions with
public types embedded in the executable `.ts` source.

`Strict<typeof User, TValue>` is a source-side helper for literal
fixtures/configs where TypeScript can evaluate checks such as string
`min/max`, string/number `oneOf`, basic email shape, numeric bounds, and
nested object defaults:

```ts
type ValidFixture = JIT.Strict<typeof User, { name: "Pedro"; role: "admin" }>;
type InvalidFixture = JIT.Strict<typeof User, { name: "Ana"; role: "root" }>; // never
```

Tree-shaking is proven by a real bundler in the test suite: importing only
`isUser` produces a bundle with **no serializer, no codec, no error class,
no namespace object**. An artifact object exports only that object;
standalone artifacts export only those functions. Operations whose
bindings hold user callbacks (`refine`, computed mapper fields) are skipped
with a reported reason instead of silently miscompiling.

### Reconstructive artifacts

`jit-artifact` transports the exact generated source without asking the target
machine to rediscover schemas or run the compiler:

```bash
pnpm artifact:build
./target/release/jit-artifact pack src/generated/jit \
  --output-root src/generated/jit \
  --output user.jit
./target/release/jit-artifact verify --file user.jit
./target/release/jit-artifact diff --file user.jit --patch
./target/release/jit-artifact apply --file user.jit
```

The canonical envelope records ordered paths, exact bytes, BLAKE3 content and
envelope digests, compression metadata and an untrusted destination
suggestion. Applying always performs bounded decoding before preview, rejects
unsafe paths and symlink crossings, stages the whole tree, rereads it, then
uses an atomic directory rename. `--yes` skips only confirmation.

The browser [Artifact Lab](https://jit-site.vercel.app/lab) produces the same
`jit1_` protocol via WASM. Its schema editor sends a closed JSON description
to the AOT compiler; arbitrary TypeScript is never evaluated. A Lab token can
be passed directly to `inspect`, `verify`, `diff` or `apply`.

See the
[complete artifact guide](../../apps/site/content/docs/aot/artifact-cli.mdx)
for configuration, rollback, limits and the integrity-versus-identity trust
model.

---

## MCP server — `jit-mcp`

jit ships an MCP `2025-11-25` stdio server for coding agents working inside a
project. It exposes structured project context, docs search, AOT doctor,
declaration inspection, read-only generated-source previews, and explicitly
confirmed generation. Resources cover architecture, status, config, AOT
inventory, docs, and generated artifacts; prompts guide schema design, AOT
workflows, and measured performance reviews.

Example client config:

```json
{
  "mcpServers": {
    "jit": {
      "command": "pnpm",
      "args": ["exec", "jit-mcp"]
    }
  }
}
```

The process working directory is the workspace security boundary. Use
`JIT_MCP_ROOT=/absolute/project/path` when the host cannot set `cwd`. Every
path is confined to that workspace, symlinks are canonicalized, resources are
size-limited, and `jit_aot_generate` requires `{ "write": true }`.

Recommended agent sequence:

1. `jit_project_doctor`
2. `jit_aot_inspect`
3. `jit_aot_preview` for source and embedded TypeScript types
4. `jit_aot_generate` with explicit write confirmation

The MCP implementation has no SDK dependency, so installing the compiler does
not add an agent framework to application runtime graphs. See the
[complete MCP guide](https://github.com/pedro5g/jit/blob/main/docs/features/mcp-server.md)
for all tools, resources, prompts, errors, and security details.

---

## Cache and reuse

Runtime compilation is cached by schema identity. Declare schemas and compiled
operations once at module scope, then reuse the resulting function:

```ts
const is = JIT.validate.is(User);
const parse = JIT.validate.parse(User);

export function receive(input: unknown) {
  return is(input) ? parse(input) : undefined;
}
```

Capability artifacts cache automatically. Cold-compilation benchmarks and
deterministic tests reset the compiler cache explicitly:

```ts
Compiler.clearCompileCache();
const isUser = JIT.validate.is(User);
isUser.compile(); // optional artifact warm-up
```

Do not disable the cache in request paths. Hash and index caches have a
different contract: `.hash()` benefits repeatedly used immutable objects;
`.keyed("id")` benefits repeated equality over large immutable arrays with
unique keys. In-place mutation can leave either cache stale. Compiled queries
reuse generated code, but never memoize query results.

Choose the collection annotation by intent:

```ts
const EntityUsers = JIT.array(User).entity({ key: "id" }); // identity only
const IndexedUsers = JIT.array(User).indexBy("id"); // indexed equality
const KeyedUsers = JIT.array(User).keyed("id"); // identity + index + unique contract

const byId = JIT.cqrs.query(KeyedUsers).keyed("id"); // fresh Map result
```

`entity` gives normalize/unique/sort compilers a default key without changing
array equality. `indexBy` selects order-independent keyed equality and builds a
weakly cached `Map` only at 64 items or more. Schema `keyed` combines both and
declares that keys are unique; query `keyed` is a separate one-pass collector,
not a persistent cache. See the [complete entity and index guide](https://jit-site.vercel.app/docs/reference/operators/entity-keyed-and-indexes).

See the [complete cache, hash and index guide](https://jit-site.vercel.app/docs/runtime/cache-hash-index)
for configuration placement, the 64-item adaptive index threshold, hash
collision handling, watched-list invalidation and AOT tree shaking.

---

## Optimization playbook

Every emitter follows the same set of strategies — this is where the numbers
come from, and every one of them is locked by golden-source or snapshot tests:

**Generated-code shape (V8-friendly by construction)**

- **Monomorphic code only** — static property access on known shapes, never
  `for...in` / `Object.keys`; object literals with a stable key order so V8
  keeps one hidden class per shape.
- **Adaptive binary memory** — compact mixed rows use `DataView`; naturally
  aligned or explicitly aligned rows use specialized typed views. Enums,
  literal unions, and booleans compare integer codes in the hot loop.
- **Cheapest checks first** — `typeof` → null → numeric comparisons → length
  window → regex. An invalid `is()` exits in ~3 ns because the first failing
  gate returns immediately.
- **Classic indexed loops, no closures, no `push`** — `for (let i = 0; ...)`
  with `out[j++]` writes; callbacks never appear inside generated hot paths.
- **Function splitting for TurboFan** — large validators split into hoisted
  helper functions (typia-style `iu1`/`pu1` union predicates) that live at
  the top of the compiled scope, so V8 can inline each piece.
- **NaN-safe logic normalization** — the optimizer flattens n-ary and/or,
  applies De Morgan, folds literal comparisons, and reorders conditions by a
  cost table — but never inverts `>`/`>=`/`<`/`<=` under `not`, because NaN
  breaks that equivalence. Equal and query keep **separate cost models**.

**Do the work once**

- **External bindings, never interpolation** — runtime values (regexes,
  callbacks, query arguments) are `Function` parameters (`__q0`, `__v0`),
  so a compiled template is pure and cacheable.
- **Two-tier compile cache** — Tier A caches applied functions per schema
  (equal/clone/validator/...); Tier B caches the source template and rebinds
  user values per compile (query/mapper). The second `.compile()` of an
  identical plan is a map lookup.
- **AOT ahead of everything** — generation moves compilation to build time:
  self-contained zero-import modules, exact-name standalone exports for
  explicit compiled functions, and grouped objects only for object-style
  artifact objects (proven with esbuild in the test suite).

**Allocate only when the data changes**

- **Structural sharing everywhere** — `parse` returns the input reference
  when nothing rebuilds; `update` copies only the touched path; `mask` and
  `sanitize` rebuild only subtrees containing marked fields.
- **Loop fusion** — a query pipeline (`filter → select → unique → orderBy`)
  is one loop with zero intermediate arrays; `JIT.map.many` fuses mapping
  into a single preallocated pass.
- **Inline hashing** — FNV-1a with `Math.imul` and bitwise mixing emitted
  directly into the function (no `JSON.stringify`), plus a WeakMap hash
  cache powering the equal short-circuit strategy.
- **Strategy hints** — `.entity({ key })`, `.indexBy()`, `.ordered()`,
  `.hash()` switch equality and lookups to keyed-index / binary-search /
  hash-short-circuit code paths.

**Serialization-specific**

- **String escape fast path** — short strings are char-scanned, long ones
  regex-probed; clean strings concatenate raw (`'"' + s + '"'`), and
  `JSON.stringify` runs only when escaping is actually needed. Static JSON
  key prefixes (`,"name":`) are baked into the source.
- **Single-allocation binary encode** — worst-case sizing pass, one
  `ArrayBuffer`, one write pass via `TextEncoder.encodeInto` straight into
  the buffer, exact `subarray` out; optionals packed as 2-bit bitmasks so
  absent fields never shift the layout.
- **Native coercions inlined** — `JIT.coerce.*` emits `Number(v)` /
  `new Date(v)` in place of a callback binding, keeping coerced validators
  serializable ahead of time.

---

## Errors

Everything throws typed `JITError`s (`code`, `message`, `meta`):
`VALIDATION_FAILED` (as `JITValidationError` with `.issues`),
`UNSUPPORTED_SCHEMA`, `INVALID_OPERATION`, `INVALID_MAPPER`, ...

## Package layout

```
jit
├── JIT        schema factories + every compile* entry point (main API)
├── AOT        generate(), defineConfig(), discovery, CLI backing
├── AST        schema AST: TypeName, defs, Typeof helpers
├── Compiler   low-level emitters (emit*Source) and IR utilities
├── Errors     JITError / JITValidationError
├── Runtime    helpers referenced by generated code (getIndex, hashing)
└── Transform  pure schema-to-schema transforms
```

See [docs/architecture.md](../../docs/architecture.md) for the full pipeline
(`DSL → AST → IR → optimizer → codegen`) and the codegen rules every emitter
follows.
Feature-specific guides live in [docs/features](../../docs/features/README.md).

## Development

```sh
pnpm jit init        # create jit.config.ts in the current project root
pnpm jit doctor      # inspect resolved config/discovery
pnpm jit list        # declared types, artifact objects and artifacts
pnpm jit inspect isUser --stage source
pnpm jit generate    # generate the configured AOT package
pnpm jit clean       # remove configured generated output
pnpm test            # vitest + typecheck + golden sources + snapshots
pnpm bench:validate  # Zod 4 / typia / JIT runtime / JIT AOT validation bench
pnpm bench:json      # native JSON / typia / Zod parse and parse+validate bench
pnpm bench:load      # 10k/100k validation load vs TypeBox / typia / Zod
pnpm bench:flows     # high-volume validate + query + JSON pipeline bench
pnpm bench:all       # all mitata suites (equal/clone/query/validate/serialize/...)
pnpm bench:report    # regenerate docs/internal/BENCH.md from latest results
pnpm bench:coldstart # fresh-process AOT vs runtime compile
pnpm clean:artifacts # rm -rf ignored package build artifacts generated by zshy
pnpm format          # biome
```
