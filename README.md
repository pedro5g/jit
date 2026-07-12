<p align="center">
  <img src="./jit-logo.png" alt="JIT compiled data engine" width="420" />
</p>

# JIT

JIT is a compiled TypeScript data engine. Describe a schema once and compile
specialized validation, equality, cloning, diffing, hashing, updates, queries,
mapping, serialization, codecs, streaming, and binary processing operations.

```ts
import { JIT } from "@pedro5g/jit/runtime";

const User = JIT.object({
  id: JIT.int().positive(),
  email: JIT.string().email(),
  role: JIT.oneOf("admin", "user"),
});

const validateUser = JIT.validate(User).safeParse().compile();
const result = validateUser(input);
```

Runtime JIT compiles and caches an operation on first use. AOT discovers only
the operations explicitly selected by the application and emits standalone,
typed, import-free functions so the compiler does not ship in the production
bundle.

## Install

```sh
pnpm add @pedro5g/jit
```

JSR users can install the same version and API:

```sh
deno add jsr:@pedro5g/jit
```

## Documentation

- [Package guide](packages/jit/README.md)
- [Architecture](docs/architecture.md)
- [Feature guides](docs/features/README.md)
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
