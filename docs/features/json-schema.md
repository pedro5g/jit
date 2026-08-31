# JSON Schema Bridge

`JIT.jsonSchema` is a two-way bridge between a JIT schema and a JSON Schema
document. `to` describes a schema as a document; `from` turns a document into a
schema every compiled operation understands.

Both directions exist so that a contract has **one** source of truth,
whichever side it starts on: a schema you own, or a document someone hands you.

## `to` — schema to document

```ts
const User = JIT.object({
  id: JIT.number().int32().positive(),
  email: JIT.string().email(),
  role: JIT.union(JIT.literal("admin"), JIT.literal("member")),
});

JIT.jsonSchema.to(User);
```

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "id": { "type": "integer", "format": "int32", "exclusiveMinimum": 0 },
    "email": { "type": "string", "format": "email" },
    "role": { "anyOf": [{ "const": "admin" }, { "const": "member" }] }
  },
  "required": ["id", "email", "role"],
  "additionalProperties": false
}
```

The document reports what the compiled validator enforces, and nothing else.

### Options

| Option                 | Default           | Purpose                                                        |
| ---------------------- | ----------------- | -------------------------------------------------------------- |
| `target`               | `"draft-2020-12"` | protocol version: also `draft-07`, `draft-04`, `openapi-3.0`   |
| `io`                   | `"output"`        | describe the produced value, or the accepted one (`"input"`)   |
| `unsupported`          | `"throw"`         | `"any"`, or a function returning a node / `"any"` / `"throw"`  |
| `cycles`               | `"ref"`           | `"throw"` to refuse a schema that cannot be inlined            |
| `reused`               | `"inline"`        | `"ref"` extracts repeated schemas into the defs                |
| `override`             | —                 | last word over every node; mutate `context.node`               |
| `ref`                  | —                 | turns a schema `id` into an external `$ref` URI                |
| `dialect`              | auto              | emit the `$schema` keyword                                     |
| `additionalProperties` | auto              | force the object policy instead of deriving it                 |

### What is representable

A type is representable **exactly when JIT's own JSON serializer defines a wire
form for it**. That is the rule, not a list of special cases:

- `JIT.date()` and the temporal schemas become `{ "type": "string", "format": "date-time" }`,
  because that is literally what `JIT.json.stringify` writes;
- `bigint`, `symbol`, `Map`, `Set`, `File`, `Promise`, `undefined`, `void`,
  `function`, `instanceof` and `custom` have no wire form, so they go through
  the `unsupported` policy.

The default is to throw, with the path in the message:

```
Set is not JSON data (at /properties/tags); pass unsupported: "any" to emit {}
instead, or a function to substitute a node
```

Silence would be worse than an error: a document claiming `{}` for a `Set`
tells consumers "anything goes" about a field the validator rejects.

Custom refinements, transforms and brands are dropped rather than
approximated, for the same reason.

### `io` — which side of the schema

```ts
const Payload = JIT.object({ id: JIT.int(), retries: JIT.number().default(3) });

JIT.jsonSchema.to(Payload);                 // required: ["id", "retries"], closed
JIT.jsonSchema.to(Payload, { io: "input" }) // required: ["id"], open
```

`"output"` is what the validator produces: defaults applied, unknown keys
stripped. `"input"` is what a caller may send.

### Metadata

`.meta()` attaches documentation that never affects validation:

```ts
const Port = JIT.number().min(1).max(65535).meta({
  title: "Port",
  description: "TCP port",
  examples: [80, 443],
  custom: { "x-internal": true },
});
```

`custom` keywords are merged last, so they win over the generated ones — the
escape hatch for a vendor extension or a hand-picked `format`.

### Targets

Each protocol version is one descriptor in
[`dialects.ts`](../../packages/jit/src/compiler/json-schema/dialects.ts).
The emitter never branches on a version name; it reads capabilities:

| Capability          | 2020-12       | draft-07      | draft-04      | OpenAPI 3.0   |
| ------------------- | ------------- | ------------- | ------------- | ------------- |
| definitions         | `$defs`       | `definitions` | `definitions` | `definitions` |
| `$ref` siblings     | yes           | `allOf` wrap  | `allOf` wrap  | `allOf` wrap  |
| single value        | `const`       | `const`       | `enum: [v]`   | `enum: [v]`   |
| tuples              | `prefixItems` | `items: []`   | `items: []`   | `items: []`   |
| exclusive bounds    | number        | number        | boolean       | boolean       |
| null                | type union    | type union    | type union    | `nullable`    |
| examples            | `examples`    | `examples`    | `examples`    | `example`     |

**Adding a version is adding a descriptor.** Keep the flags behavioural
("can a `$ref` carry siblings?") rather than nominal ("is this draft-07?") so
the next dialect composes instead of forking the emitter.

### Cost

The document is static data derived from the schema alone, so it is computed
once per schema/options pair and returned frozen. AOT inlines it as a frozen
object literal: the application ships the document, never the translator.

```ts
// generated
const userDocument: { readonly [key: string]: unknown } = /*#__PURE__*/ Object.freeze({ … });
```

Passing `override` or a function `unsupported` makes the result
caller-specific, so those calls are not memoized.

## `from` — document to schema

```ts
const User = JIT.jsonSchema.from({
  type: "object",
  properties: {
    name: { type: "string" },
    age: { type: "number" },
    nickname: { type: "string" },
  },
  required: ["name", "age"],
} as const);

const isUser = JIT.validate.is(User);
// (value: unknown) => value is { name: string; age: number; nickname?: string }
```

The document already states the shape, so the type is **read from the literal**
rather than declared a second time. Pass the document `as const` and every
compiled operation is typed from it.

Type inference lives in
[`infer.ts`](../../packages/jit/src/compiler/json-schema/infer.ts) and walks
the same keywords the runtime builder reads, in the same order. Adding a
keyword to one means adding it to the other; that pair is the contract.
Anything unread degrades to `unknown`, never to `any`.

### What is read

`type` (including type unions), `const`, `enum`, `properties`/`required`,
`additionalProperties`, `items`/`prefixItems`/`additionalItems`, `anyOf`,
`oneOf`, `allOf`, `nullable`, `$ref` into `$defs`/`definitions`, `default`,
string `format`/`pattern`/`minLength`/`maxLength`, numeric
`minimum`/`maximum`/`exclusive*`/`multipleOf`, array
`minItems`/`maxItems`/`uniqueItems`, and the annotation keywords.

Constraints become the same compiled checks a hand-written schema produces —
`format: "email"` is the specialized email check, not a generic runtime
interpreter.

### `refine` — adding what the document could not say

```ts
const Even = JIT.jsonSchema.from(document, {
  refine: ({ node, path, schema }) =>
    node.type === "integer" && path.at(-1) === "amount"
      ? JIT.custom<number>((value) => (value as number) % 2 === 0, "must be even").schema
      : schema,
});
```

`refine` runs for every node after the structural conversion. Returning a
schema replaces the built one — the place for brands, business refinements or
a format the document has no keyword for.

Set `unknownKeywords: "throw"` to refuse a document with keywords the converter
does not implement, instead of silently building a weaker schema.

### AOT

`from` resolves entirely at generation time. A declaration file that reads a
document produces exactly the same specialized functions as a hand-written
schema, and the document itself never reaches the bundle:

```ts
// jit/user.jit.ts
const userSchema = JIT.jsonSchema.from(contract as const);

export type User = JIT.Typeof<typeof userSchema>;
export const isUser = JIT.validate.is(userSchema);
```

```ts
// generated/index.ts — no document, no converter
export type User = { id: number; name: string };
const isUser: (value: unknown) => value is User = function is(value) { … };
```

## Known limits

- External `$ref` URIs are refused rather than fetched. Inline the definition,
  or supply it through `refine`.
