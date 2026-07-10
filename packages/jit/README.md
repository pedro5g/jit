<p align="center">
  <img src="../../jit-logo.png" alt="jit — the compiled data engine" width="420" />
</p>

# jit — the compiled data engine

Describe a data shape **once**, and jit compiles specialized JavaScript for
**every** operation over it: validation, equality, cloning, diffing, hashing,
immutable updates, in-memory queries, DTO mapping, PII masking, XSS
sanitizing, JSON serialization, a versioned binary codec, and progressive
streaming validation.

Two execution modes, same generated code:

- **JIT (runtime)** — operations compile on first use via
  `globalThis.Function` and are cached per schema.
- **AOT (build time, Prisma-style)** — `pnpm jit init` writes config and
  `jit generate` writes pure `.mjs` + `.cjs` + `.d.ts` modules with **zero
  imports**: the engine never ships to production, and the final bundle keeps
  only the generated low-level functions the app actually imports.

```ts
import { JIT } from "jit";

const User = JIT.object({
  id: JIT.number().int().positive(),
  name: JIT.string().min(2, "name is too short"),
  email: JIT.string().email().pii("mask"),
  role: JIT.union(JIT.literal("admin"), JIT.literal("user")),
  tags: JIT.array(JIT.string()).max(8),
});

type User = JIT.infer<typeof User>;

const Users = JIT.validator(User);

Users.is(input); // pure boolean guard — compiled specialized code
Users.parse(input); // throws JITValidationError with every issue
Users.safeParse(input); // { success, data | issues } — no exceptions
```

## Why compiled?

Generic libraries interpret your schema on every call — walk the tree, branch
on types, allocate intermediates. jit walks the schema **once, at compile
time**, and emits the exact monomorphic code a performance engineer would
write by hand: static property access only (never `for...in` / `Object.keys`
on known shapes), checks ordered cheapest-first (`typeof` → null → numeric →
length → regex), classic indexed loops, no closures, early returns. Runtime
values (regexes, refinement callbacks, query arguments) travel as external
bindings — never interpolated into source.

Measured on this repo's validation benchmark (mitata, Node 22.17.1,
linux-x64, AMD Ryzen 7 5800H, Zod 4.4.3 — run `pnpm bench:validate` for your
machine):

| Scenario                      | JIT runtime  | JIT AOT       | Zod 4     | AOT heap/op | Zod heap/op | AOT vs Zod  |
| ----------------------------- | ------------ | ------------- | --------- | ----------- | ----------- | ----------- |
| `is()` valid object           | **57.72 ns** | 58.82 ns      | 894.07 ns | 0.28 b      | 2.29 kb     | **15.2x**   |
| `is()` invalid object         | **2.68 ns**  | 2.70 ns       | 29.60 µs  | 0.03 b      | 16.16 kb    | **10,963x** |
| `safeParse` valid object      | 68.95 ns     | **67.74 ns**  | 810.21 ns | 40.24 b     | 1.92 kb     | **12.0x**   |
| `safeParse` invalid, 7 issues | 126.18 ns    | **120.70 ns** | 25.14 µs  | 624.11 b    | 5.25 kb     | **208.3x**  |

## Install

```sh
pnpm add jit
```

---

## Schemas

zod-like builders; every schema carries its inferred type
(`JIT.infer<typeof X>` works on builders and raw schemas).

```ts
// primitives
JIT.string()  JIT.number()  JIT.int()  JIT.boolean()  JIT.bigint()
JIT.date()    JIT.literal("click")
JIT.enum({ A: "a", B: "b" })  JIT.enum(["admin", "user"] as const)
JIT.null()    JIT.undefined()  JIT.any()  JIT.unknown()  JIT.never()

// collections
JIT.array(T)  JIT.set(T)  JIT.map(K, V)  JIT.record(K, V)
JIT.tuple(A, B)  JIT.object({ ... })

// composition
JIT.union(A, B, C)                       // variadic
JIT.discriminatedUnion("kind", [A, B])   // tagged, O(1) dispatch
JIT.intersection(A, B)

// wrappers (chainable on any builder)
.optional() .nullable() .nullish() .readonly() .promise()
.default(value | () => value) .brand("UserId")
.refine((v) => v.ok, "custom message") .pipe((v) => transform(v))
```

Objects are mutable by default for normal TypeScript ergonomics. Use
`.readonly()` when the parsed output must be frozen at the root.

### Advanced schemas

```ts
JIT.json(); // any JSON-encodable value
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
```

Value codecs are bidirectional transforms, separate from the binary wire
codec:

```ts
const stringToDate = JIT.codec(JIT.string().datetime(), JIT.date(), {
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
  .regex(/^[a-z]+$/, "lowercase only");
JIT.number().int("must be an integer").positive().multipleOf(5);
JIT.array(JIT.string()).nonEmpty("pick at least one tag");
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
JIT.string().date().time({ precision: 0 }).datetime({ offset: true });
JIT.string().duration().emoji();
JIT.string().digest("sha256", "base64url"); // md5..sha512 digests
```

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
JIT.string().pii("mask")       // for JIT.mask: "redact" | "mask" | "hash"
JIT.string().sanitize()        // XSS stripping, fused into parse
JIT.object({...}).entity({ key: "id" }).indexBy("id")  // strategy hints
JIT.object({...}).hash("ordered")                      // equal short-circuit
```

### Object algebra

```ts
Base.pick("id", "name")  Base.omit("secret")  Base.partial()
Base.extend({ tag: JIT.string() })  Base.merge(Other)

const Strict = Base.strict(); // reject unknown keys
const Loose = Base.loose(); // preserve unknown keys
const WithFlags = Base.catchall(JIT.boolean()); // validate/transform extras
const BaseKeys = Base.keyof(); // enum of known object keys
```

---

## Validation

```ts
const Users = JIT.validator(User);

Users.is(x); // (x: unknown) => x is User — zero allocation
Users.safeParse(x); // { success: true, data } | { success: false, issues }
Users.parse(x); // data or throws JITValidationError

// async: settles promise wrappers, then validates the resolved value
const Job = JIT.object({ result: JIT.string().min(3).promise() });
await JIT.validator(Job).parseAsync({ result: fetchResult() });
```

Validators can be compiled selectively. The compiler emits only the requested
surface plus the minimum shared internals needed by that surface:

```ts
const Selected = JIT.validator(User, { is: true, parse: true });
Selected.is(input);
Selected.parse(input);
Selected.safeParse; // ✗ not compiled

const { is, parse } = JIT.validator(User).get("is", "parse");
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
const User = JIT.model(schema); // lazy: compiles each op on first access

User.equal(a, b); // schema-aware deep equality with strategies
User.clone(a); // static-literal deep clone
User.diff(a, b); // structural diff entries
User.hash(a); // inline FNV-1a — no JSON.stringify
User.update(a, { name: "Ada" }); // immutable surgical update (no Proxy)
User.stringify(a); // compiled JSON — beats native
User.fromJSON(json); // JSON.parse + compiled validation
User.mask(a); // PII-safe copy for logs
User.sanitize(a); // XSS-stripped copy
User.codec.encode(a); // binary wire format
```

## Query DSL

Fused single-loop pipelines over collections — no intermediate arrays:

```ts
const admins = JIT.query(UserList)
  .filter((q) => q.and(q.not(q.eq("role", "blocked")), q.gt("id", 100)))
  .select("id", "name", "role")
  .unique("id")
  .orderBy("name", "asc")
  .compile();

admins(users); // one pass, out[j++] writes, zero allocation waste

// terminals
JIT.query(UserList)
  .filter((q) => q.eq("role", "user"))
  .avg("id")
  .compile();
// sum / count / avg / min / max — empty: sum/count → 0, others → undefined

// keyed collections, grouping, and mutations
JIT.query(UserList).groupBy("role").compile();
JIT.query(UserList)
  .filter((q) => q.lt("score", 0))
  .delete()
  .compile();
JIT.query(UserList)
  .filter((q) => q.eq("id", 7))
  .update({ active: false })
  .compile();
```

## DTO mapper

Whitelist by construction — only target-schema fields can exist in the
output, so accidental `passwordHash` leaks are impossible:

```ts
const toDTO = JIT.mapper(UserEntity, PublicUser, {
  name: { from: "fullName" }, // rename
  label: (user) => `${user.name}#${user.id}`, // computed
});

toDTO.map(entity); // ~7ns — faster than a hand-written literal
toDTO.many(entities); // fused indexed loop over the list
```

## Security

```ts
const mask = JIT.mask(User); // .pii() fields → "***" / last-4 / FNV hash
logger.info(mask(user)); // LGPD/GDPR-safe structured logs

const clean = JIT.sanitize(Form); // strips <script>/<style>/tags, escapes <>
```

Both are surgical: only paths containing marked fields are rebuilt, untouched
subtrees are shared by reference. Sanitization also runs **inside**
`parse`/`safeParse` for `.sanitize()` fields — validation + cleanup in one pass.

## Serialization

### JSON

```ts
const json = JIT.serializer(User);

json.stringify(user); // static keys baked in; escape fast path
json.parse(body); // JSON.parse + compiled validation
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

## Explicit compilation — `JIT.compile`

The opt-in aggregation: pass already-compiled functions and extras in one
object. Only those properties exist at runtime, in types, and in AOT output.
This is the preferred shape when you want `User.is()` style imports.

```ts
const UserSchema = JIT.object({
  id: JIT.number(),
  name: JIT.string(),
  role: JIT.union(JIT.literal("admin"), JIT.literal("user")),
});

const selected = JIT.validator(UserSchema).get("is", "parse");

export const User = JIT.compile(UserSchema, {
  is: selected.is,
  parse: selected.parse,
  findAdmins: JIT.query(UserList)
    .filter((q) => q.eq("role", "admin"))
    .compile(),
  toDTO: JIT.mapper(UserSchema, PublicUser),
});

User.is(input);
User.findAdmins(users); // your query, no prefixes, fully typed
User.toDTO.many(users);
User.clone(x); // ✗ does not exist — not requested, not compiled
```

## AOT — `jit generate`

Create the config in the project root:

```sh
pnpm jit init
```

Generated `jit.config.ts`:

```ts
import { AOT } from "jit";

export default AOT.defineConfig({
  // Omit schemas to scan from the project root. Entries can be files,
  // directories, or globs.
  // schemas: ["src/schemas/**/*.ts"],
  // Default discovery is **/*.jit.ts; change or add patterns when your
  // declarations use another shape.
  patterns: ["**/*.jit.ts"],
  // Generated files are importable directly from your app.
  outDir: "node_modules/@jit/generated",
  packageName: "@jit/generated",
  // Use false when generating into a project source folder instead of
  // node_modules/@jit/generated.
  emitPackageJson: true,
  // Delete only jit's known generated files before writing fresh output.
  clean: true,
});
```

Discovery rules are intentionally boring:

- if `schemas` is omitted, `jit generate` scans from the project root;
- `schemas` accepts files, directories, and globs like
  `src/schemas/**/*.ts`;
- `patterns` controls directory scans; the default is `**/*.jit.ts`;
- if no buildable functions are exported, the CLI prints a warning and writes
  nothing.

There is no raw-schema fallback. AOT builds only what you explicitly export.

```ts
// src/user.jit.ts — discovered by convention (**/*.jit.ts)
import { JIT } from "jit";

const UserSchema = JIT.object({
  id: JIT.number(),
  name: JIT.string(),
  role: JIT.string(),
});

const selected = JIT.validator(UserSchema).get("is", "parse");

// Standalone functions keep their declared export names exactly.
export const User_is = selected.is;
export const User_parse = selected.parse;

// Object-style aggregation exports one object: User.is, User.parse, ...
export const User = JIT.compile(UserSchema, {
  is: selected.is,
  parse: selected.parse,
  findAdmins: JIT.query(JIT.array(UserSchema))
    .filter((q) => q.eq("role", "admin"))
    .compile(),
});
```

```ts
import { User, User_is, User_parse } from "@jit/generated";

User.is(input);
User.findAdmins(users);
User_is(input);
User_parse(input);
```

Run generation:

```sh
pnpm jit generate
pnpm jit generate src/user.jit.ts --out generated --name @acme/models
pnpm jit generate --pattern "src/schemas/**/*.ts"
pnpm jit generate --watch
```

Output: `index.mjs` + `index.cjs` + `index.d.ts`/`.d.cts` + `package.json`
(exports map, `sideEffects: false`). The module is **fully self-contained**:
compiled functions, tiny error class, hash/index helpers, and codec helpers
are inlined. There is no `import "jit"` in generated runtime code, so the
final app bundle carries only the low-level specialized functions it imports.

Types are derived from your schema file, never re-emitted by hand:

```ts
// grouped marker
export type User = import("jit").Infer<
  typeof import("../src/user.jit.js").User
>;
export declare const User: {
  readonly is: (value: unknown) => value is User;
  readonly parse: (value: unknown) => User;
};

// standalone explicit export
export declare const User_is: typeof import("../src/user.jit.js").User_is;
```

Tree-shaking is proven by a real bundler in the test suite: importing only
`User_is` produces a bundle with **no serializer, no codec, no error class,
no namespace object**. Object-style markers export only the object;
standalone explicit functions export only those functions. Operations whose
bindings hold user callbacks (`refine`, computed mapper fields) are skipped
with a reported reason instead of silently miscompiling.

---

## Optimization playbook

Every emitter follows the same set of strategies — this is where the numbers
come from, and every one of them is locked by golden-source or snapshot tests:

**Generated-code shape (V8-friendly by construction)**

- **Monomorphic code only** — static property access on known shapes, never
  `for...in` / `Object.keys`; object literals with a stable key order so V8
  keeps one hidden class per shape.
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
  `JIT.compile` markers (proven with esbuild in the test suite).

**Allocate only when the data changes**

- **Structural sharing everywhere** — `parse` returns the input reference
  when nothing rebuilds; `update` copies only the touched path; `mask` and
  `sanitize` rebuild only subtrees containing marked fields.
- **Loop fusion** — a query pipeline (`filter → select → unique → orderBy`)
  is one loop with zero intermediate arrays; `mapper.many` fuses mapping
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
├── AST        schema AST: TypeName, defs, Infer helpers
├── Compiler   low-level emitters (emit*Source) and IR utilities
├── Errors     JITError / JITValidationError
├── Runtime    helpers referenced by generated code (getIndex, hashing)
└── Transform  pure schema-to-schema transforms
```

See [docs/architecture.md](../../docs/architecture.md) for the full pipeline
(`DSL → AST → IR → optimizer → codegen`) and the codegen rules every emitter
follows.

## Development

```sh
pnpm jit init        # create jit.config.ts in the current project root
pnpm jit generate    # generate the configured AOT package
pnpm test            # vitest + typecheck + golden sources + snapshots
pnpm bench:validate  # Zod 4 / typia / JIT runtime / JIT AOT validation bench
pnpm bench:all       # all mitata suites (equal/clone/query/validate/serialize/...)
pnpm bench:report    # regenerate docs/internal/BENCH.md from latest results
pnpm bench:coldstart # fresh-process AOT vs runtime compile
pnpm format          # biome
```
