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

const validateUser = JIT.validate(User).safeParse().compile();
const result = validateUser(input);

type User = JIT.Typeof<typeof User>;
```

Runtime JIT compiles and caches an operation on first use. AOT discovers only
the operations explicitly selected by the application and emits standalone,
typed, import-free functions so the compiler does not ship in the production
bundle.

## Portable AOT Artifacts

Direct TypeScript is the default AOT output. It keeps generated code inside the
application's normal type-check and bundling pipeline:

```sh
pnpm jit generate
```

```ts
// input: src/aot/user.jit.ts
import { JIT } from "@jit-compiler/jit/define";

const User = JIT.object({
  id: JIT.number().int32(),
  name: JIT.string().min(2),
});

export const isUser = JIT.validate(User).is().compile();
```

```ts
// output: src/generated/jit/index.ts
export type User = { id: number; name: string };
export const isUser: (value: unknown) => value is User = function is(value) {
  // specialized checks only
};
```

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

## New In 1.0.4

The `1.0.4` release adds configurable source-compiled sanitization, reactive
immutable update stores, explicitly selected model operations, and DTO
boundary aggregates:

```ts
const Comment = JIT.object({
  title: JIT.string().sanitize("text"),
  body: JIT.string().sanitize({
    preset: "none",
    html: { mode: "allow", tags: ["p", "strong", "code"] },
    normalize: "NFC",
    maxLength: 4_000,
  }),
});

const ReadUser = JIT.model(User).get("is", "parse", "equal");
const CreateUserDTO = JIT.dto(CreateUserSchema).get("parse", "fromJSON");
const userState = JIT.update(User).reactive(initialUser);

userState.watch(["profile", "name"], ({ value }) => renderName(value));
userState.update({ profile: { name: "Ada" } });
```

The browser playground now includes executable `sanitize`, `reactiveUpdate`,
`dto`, `model`, and `indexes` scenarios. The indexes scenario contrasts
`.entity()`, `.indexBy()`, schema `.keyed()`, and query `.keyed()` directly.

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
- [Sanitization](https://jit-site.vercel.app/docs/reference/operators/strings#sanitization)
- [Reactive updates](https://jit-site.vercel.app/docs/runtime/reactive-updates)
- [DTO aggregates](https://jit-site.vercel.app/docs/runtime/dtos)
- [Entity, keyed, and index guide](https://jit-site.vercel.app/docs/reference/operators/entity-keyed-and-indexes)
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
