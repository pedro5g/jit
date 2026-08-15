<p align="center">
  <img src="./jit-logo.png" alt="JIT compiled data engine" width="420" />
</p>

# JIT

JIT is a compiled TypeScript data engine. Describe a schema once and compile
specialized validation, equality, cloning, diffing, hashing, updates, queries,
mapping, serialization, codecs, streaming, and binary processing operations.

```ts
import { JIT } from "@jit-compiler/jit/runtime";

const User = JIT.object({
  id: JIT.int().positive(),
  email: JIT.string().email(),
  role: JIT.oneOf("admin", "user"),
});

const parseUser = JIT.validate.safeParse(User);
const result = parseUser(input);

type User = JIT.Typeof<typeof User>;
```

Runtime JIT compiles and caches an operation on first use. AOT reads your
declaration files and emits standalone, typed, import-free functions, so the
compiler never ships in the production bundle.

## The API

Every capability is reached through exactly one namespace. There are no root
aliases and no `.compile()` step — a compiled artifact *is* the function.

| Namespace      | Members                                                              |
| -------------- | -------------------------------------------------------------------- |
| `JIT.validate` | `is`, `parse`, `safeParse`, `issues`, `async.parse`, `async.safeParse` |
| `JIT.compare`  | `equal`, `diff`, `hash`                                              |
| `JIT.security` | `mask`, `sanitize`                                                   |
| `JIT.json`     | `parse`, `stringify`, `stringifyChunks`, `value`                     |
| `JIT.binary`   | `encode`, `decode`, `codec`                                          |
| root           | `clone`, `format`, `jsonSchema`, `mock`, `from`, `map`, `query`, `transform`, `update`, `watch`, `stream`, `process`, `dto`, plus every schema factory |

```ts
const isUser = JIT.validate.is(User);
const equalUser = JIT.compare.equal(User);
const maskUser = JIT.security.mask(User);
const toJson = JIT.json.stringify(User);

isUser(input);
equalUser(a, b);
```

The same schema also describes and populates itself, so neither an OpenAPI
component nor a test fixture becomes a second source of truth:

```ts
const userDocument = JIT.jsonSchema.to(User); // JSON Schema 2020-12, static data
const mockUser = JIT.mock(User); // values that pass JIT.validate.is(User)

mockUser({ seed: 7 }); // reproducible fixture
```

The bridge runs both ways, so a contract that arrives as data becomes a schema
whose type is read straight from the literal:

```ts
const Order = JIT.jsonSchema.from({
  type: "object",
  properties: { id: { type: "integer" }, sku: { type: "string" } },
  required: ["id", "sku"],
} as const);

const isOrder = JIT.validate.is(Order);
// (value: unknown) => value is { id: number; sku: string }
```

Every compiled validation artifact also implements
[Standard Schema](https://standardschema.dev), so it can be handed straight to
any consumer in the ecosystem.

Queries are builders that *are* the query, with alternative result shapes
behind `.to`:

```ts
const activeAdmins = JIT.query(JIT.array(User))
  .filter((q) => q.and(q.eq("role", "admin"), q.eq("active", true)))
  .select("id", "email");

activeAdmins(users); // eager array
activeAdmins.to.iterator(); // pull-based generator
activeAdmins.to.visitor(); // push-based sink, no result array
```

Boundary work composes into one typed execution artifact instead of manually
wiring individual compilers:

```ts
const PublicUsers = JIT.json
  .parse(JIT.array(User))
  .validate()
  .update({ role: "user" })
  .filter((q) => q.eq("role", "user"))
  .select("id", "email")
  .to.json();

const response = PublicUsers(requestBody);
```

Runtime and AOT lower that plan once. JSON uses native `JSON.parse` followed
immediately by generated validation; adjacent query stages share one indexed
loop. `.transform(target, fields)`, `.map`, `.update`, `.sanitize`, and
`.mask` can participate in the same pipeline. The
[composable execution guide](docs/features/composable-execution.md) documents
deliberate allocation boundaries and AOT constraints.

## AOT: the declaration file is the manifest

`jit generate` reads a `*.jit.ts` file literally. A schema names a generated
type, an artifact becomes a generated function, and an object of artifacts
becomes one frozen object — `export` is optional.

```sh
pnpm jit init
pnpm jit generate
```

```ts
// input: jit/user.jit.ts
import { JIT } from "@jit-compiler/jit/define";

const User = JIT.object({
  id: JIT.number().int32(),
  name: JIT.string().min(2),
});

export const isUser = JIT.validate.is(User);

export const UserMethods = {
  is: JIT.validate.is(User),
  toJson: JIT.json.stringify(User),
  toObject: JIT.json.parse(User),
};
```

```ts
// output: generated/index.ts
export type User = { id: number; name: string };

const isUser: (value: unknown) => value is User = function is(value) {
  // specialized checks only
};

const UserMethods: {
  readonly is: (value: unknown) => value is User;
  readonly toJson: (value: User) => string;
  readonly toObject: (json: string) => User;
} = /*#__PURE__*/ Object.freeze({ /* … */ });

export { UserMethods, isUser };
```

Only two artifact shapes are emitted: `.ts` for typed projects and `.js` for
vanilla ones. Generated TypeScript carries its public signatures in the
executable source, so type resolution belongs to the application's own build —
JIT writes no declaration files and the generated module has zero imports.

The [Artifact Lab](https://jit-site.vercel.app/lab) is a free-form TypeScript
editor with the complete JIT type surface. It runs the real AOT compiler in a
terminable browser worker, previews the exact generated files and creates a
compact signed reference. Reconstruct those files without installing JIT in
the target project:

```sh
pnpm dlx @jit-compiler/cli add jlr1_<signed-reference>
```

The native Rust CLI trusts the official registry, verifies its Ed25519
signature, checks the SHA-256 content address, confines paths to the project
root and writes the complete tree transactionally. It installs no dependencies
and executes no artifact-provided commands.

## Install

```sh
pnpm add @jit-compiler/jit
```

JSR users can install the same version and API:

```sh
deno add jsr:@jit/compiler
```

```ts
import { JIT } from "jsr:@jit/compiler/runtime";
```

## Documentation

- [Package guide](packages/jit/README.md)
- [Architecture](docs/architecture.md)
- [Feature guides](docs/features/README.md)
- [CLI and config](docs/features/cli-and-config.md)
- [Composable execution](docs/features/composable-execution.md)
- [JSON Schema bridge](docs/features/json-schema.md)
- [Executable runtime and AOT examples](packages/examples/README.md)
- [Artifact tokens and Rust CLI](apps/site/content/docs/aot/artifact-cli.mdx)
- [MCP server](docs/features/mcp-server.md)
- [AOT audit](docs/aot/audit.md)
- [Release process](docs/maintainers/releases.md)
- [Changelog](CHANGELOG.md)

## Development

```sh
pnpm install
pnpm format:check
pnpm lint:check
pnpm test
pnpm build
```

Read [CONTRIBUTING.md](CONTRIBUTING.md) before changing public APIs or generated
code. Performance changes need reproducible before/after measurements, and
generated-source changes need deterministic snapshots.

## Community And Security

- Use the structured [issue forms](https://github.com/pedro5g/jit/issues/new/choose)
  for bugs, API proposals, performance reports, documentation, and questions.
- Report vulnerabilities privately according to [SECURITY.md](SECURITY.md).
- Participation is governed by the [Code of Conduct](CODE_OF_CONDUCT.md).

MIT licensed. Copyright Pedro5g.
