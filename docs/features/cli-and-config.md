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
    directory: "node_modules/@jit/generated",
    packageName: "@jit/generated",
    emitPackageJson: true,
    clean: true,
  },
  compiler: {
    packageName: "@jit-compiler/jit",
  },
  emit: {
    subpathModules: true,
    manifest: true,
    plans: true,
  },
});
```

If `entries` is omitted, discovery scans from the project root using
`patterns`. The default pattern is `**/*.jit.ts`.

`compiler.packageName` is used only by generated declaration files. npm users
should keep `@jit-compiler/jit`; a Deno/JSR project can set
`jsr:@jit/compiler`. Generated JavaScript remains self-contained and does not
import either package.

## Output Directory Choices

Use `node_modules/@jit/generated` when you want package-style imports:

```ts
import { User } from "@jit/generated";
```

Use a project-local directory when you want checked-in generated source or a
framework-specific alias:

```ts
export default AOT.defineConfig({
  entries: ["src/**/*.jit.ts"],
  output: {
    directory: "src/generated/jit",
    emitPackageJson: false,
  },
});
```

Set `emitPackageJson: false` inside application source folders to avoid
creating a nested package boundary.

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
- Use subpath modules when teams want stable imports such as `#jit/user`.
- Run `jit explain` after adding new declaration files to verify discovery.
- Run `jit clean` or `pnpm clean:artifacts` when local generated output is
  polluting the workspace.
