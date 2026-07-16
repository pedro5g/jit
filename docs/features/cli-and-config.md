# CLI And Config

The CLI is the bridge between declaration files and generated AOT output. It is
designed for a Prisma-like workflow: initialize config, inspect what will be
built, generate the package, then import from the generated module.

## Commands

```sh
pnpm jit init
pnpm jit doctor
pnpm jit explain
pnpm jit list
pnpm jit inspect User --stage plan
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

Prefer the plan-shaped config:

```ts
import { AOT } from "@jit-compiler/jit";

export default AOT.defineConfig({
  entries: ["src/schemas/**/*.jit.ts"],
  patterns: ["**/*.jit.ts"],
  output: {
    directory: "src/generated/jit",
    clean: true,
  },
  emit: {
    subpathModules: true,
    manifest: true,
    plans: true,
  },
  types: {
    package: "@jit-compiler/jit",
  },
});
```

If `entries` is omitted, discovery scans from the project root using
`patterns`. The default pattern is `**/*.jit.ts`.

`types.package` is used only by generated declaration files. npm users
should keep `@jit-compiler/jit`; a Deno/JSR project can set
`jsr:@jit/compiler`. Generated JavaScript remains self-contained and does not
import either package.

## Output Directory Choices

Use `node_modules/@jit/generated` when you want package-style imports:

```ts
import { User } from "@jit/generated";
```

The generator recognizes `node_modules` in the output path, infers the package
namespace from that path, and emits `index.mjs`, `index.cjs`, dual declarations,
`package.json`, and an exports map. `output.packageName` is only needed to
override that inferred namespace.

Use a project-local directory when you want checked-in generated source or
normal relative imports:

```ts
export default AOT.defineConfig({
  entries: ["src/**/*.jit.ts"],
  output: {
    directory: "src/generated/jit",
  },
});
```

```ts
import { User } from "./generated/jit/index.js";
```

Local output automatically emits `index.js` and `index.d.ts` without a nested
`package.json`. No package `imports` map and no `#jit` alias are required. The
JavaScript and declaration entrypoints therefore always share the same base
name and extension relationship.

## Config Reference

| Setting                  | Purpose                                                        | Default            |
| ------------------------ | -------------------------------------------------------------- | ------------------ |
| `entries`                | declaration files, directories, or globs                       | root discovery     |
| `patterns`               | patterns used for directory/root discovery                     | all `.jit.ts` files |
| `output.directory`       | local directory or package path below `node_modules`            | `generated/jit`    |
| `output.packageName`     | namespace override for a generated `node_modules` package       | inferred from path |
| `output.clean`           | remove JIT-owned files from the previous generation             | `true`             |
| `emit.subpathModules`    | add one entrypoint per declaration source                       | `false`            |
| `emit.manifest`          | write imports, layout, exports, and selected operations         | `false`            |
| `emit.plans`             | write deterministic operation plans for inspection/tooling      | `false`            |
| `types.package`          | package providing `Typeof` and `Strict` to generated `.d.ts`    | npm package name   |

## Inspection Flow

Before generating, use:

```sh
pnpm jit doctor
pnpm jit explain
pnpm jit inspect User --stage source
pnpm jit inspect User --stage declaration
```

This matters because AOT is explicit. Raw schemas do not generate output by
themselves. If no buildable functions or grouped objects are found, the CLI
warns and writes nothing.

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
- Export compiled functions, not raw schemas, for AOT output.
- Turn on `manifest` and `plans` when reviewing generated artifacts in CI.
- Use subpath modules for `@jit/generated/user` package imports or
  `./generated/user.js` local imports.
- Run `jit explain` after adding new declaration files to verify discovery.
- Run `jit clean` or `pnpm clean:artifacts` when local generated output is
  polluting the workspace.
