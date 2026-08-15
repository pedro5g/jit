# CLI And Config

The CLI is the bridge between declaration files and generated AOT output. It is
designed for a Prisma-like workflow: initialize config, inspect what will be
built, generate the module, then import it.

## Commands

```sh
pnpm jit init
pnpm jit doctor
pnpm jit list
pnpm jit inspect isUser --stage source
pnpm jit generate
pnpm jit clean
```

Development scripts in this repository:

```sh
pnpm build
pnpm clean:artifacts
pnpm test
pnpm bench:load
```

`pnpm clean:artifacts` is intentionally simple: it is an `rm -rf` over ignored
build output that zshy writes beside package source files.

## Config Shape

`jit init` detects the project: a `tsconfig.json` gets `jit.config.ts` with
TypeScript output, anything else gets `jit.config.js` with ready-to-run ESM.

```ts
import { AOT } from "@jit-compiler/jit";

export default AOT.defineConfig({
  entries: ["./jit/**/*.jit.ts"],
  output: {
    directory: "generated",
    format: "ts",
  },
});
```

That is the whole surface:

| Setting            | Purpose                                                | Default                      |
| ------------------ | ------------------------------------------------------ | ---------------------------- |
| `entries`          | declaration files, directories, or globs               | root discovery               |
| `patterns`         | patterns used for directory/root discovery             | `**/*.jit.ts`, `**/*.jit.js` |
| `output.directory` | destination relative to the config file                | `generated`                  |
| `output.format`    | `ts` (typed source) or `js` (ready-to-run ESM)         | `ts`                         |
| `output.perFile`   | one module per declaration file plus an `index` barrel | `false`                      |

If `entries` is omitted, discovery scans from the project root using
`patterns`. Generated output is always replaced: JIT deletes the files it owns
— identified by the generated banner, never by name — and leaves everything
else in the directory untouched.

## Output Layout

By default everything lands in one self-contained module:

```
generated/
  index.ts
```

`output.perFile` names each module after the declaration file it came from and
adds a barrel, keeping unrelated schemas in separate modules for bundlers that
split by import:

```
generated/
  index.ts     // re-exports both
  user.ts      // from jit/user.jit.ts
  order.ts     // from jit/order.jit.ts
```

Both layouts import the same way:

```ts
import { isUser } from "./generated/index.js";
```

Generated TypeScript carries its public signatures in the executable file
itself, so the application's own build resolves the types — JIT emits no
`.d.ts` and installs nothing at runtime. Choose `js` when the consumer needs
ready-to-run ESM and does not need generated TypeScript types.

## Inspection Flow

Before generating, use:

```sh
pnpm jit doctor            # config discovery, output target, declaration files
pnpm jit list              # every declared type, artifact object and artifact
pnpm jit inspect isUser --stage source
```

This matters because AOT is explicit. A schema on its own declares a type, not
a runtime function. If no artifacts are found, the CLI warns and writes
nothing.

## Why This Improves Performance

The CLI moves compilation work to build time:

- schema discovery happens once;
- source emission happens once;
- generated functions load as plain JavaScript;
- production code avoids `new Function`;
- front-end bundles avoid importing the compiler.

For front-end apps, the biggest win is often not one validator call. It is
removing the entire compiler/library graph from the browser bundle and keeping
only the generated functions used by the route.

## Best Practices

- Keep declaration files small and explicit.
- Let the declaration file be the manifest: a schema names its generated type,
  an artifact becomes a generated function, an object of artifacts becomes one
  frozen object.
- Keep the default TypeScript output for application source; it carries
  structural types and public signatures in the executable file itself.
- Turn on `output.perFile` when different routes import unrelated schemas.
- Run `jit doctor` after adding new declaration files to verify discovery.
- Run `jit clean` or `pnpm clean:artifacts` when local generated output is
  polluting the workspace.
