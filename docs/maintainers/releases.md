# Release Process

JIT publishes one version to npm, JSR, and GitHub Releases. A release is created
only from an immutable Git tag named `vX.Y.Z`; `packages/jit/package.json`,
`packages/jit/jsr.json`, the tag, and the changelog must agree.

## Registry Names

Both registries use `@jit/compiler`. The unscoped npm name `jit` belongs to a
different project and must never be used by this release pipeline.

## One-Time Registry Bootstrap

Before pushing the first release tag:

1. Sign in to an npm account with publish access to the `@jit` scope. npm
   requires a package to exist before trusted publishing can be configured, so
   add a short-lived granular `NPM_TOKEN` GitHub secret with publish access for
   the first release only.
2. After that first npm publication, configure a GitHub Actions trusted publisher for
   repository `pedro5g/jit` and workflow file `release.yml`. Allow
   `npm publish`.
3. Create the JSR scope `@jit` and package `@jit/compiler`.
4. In the JSR package settings, link `pedro5g/jit` as the GitHub repository.
5. Delete `NPM_TOKEN`; subsequent npm releases authenticate only through OIDC.
6. Optionally create a GitHub environment with required reviewers, then add the
   same environment name to both publish jobs and to npm's trusted publisher.

The release workflow grants `id-token: write` only to the npm and JSR jobs.
Both registries exchange that short-lived GitHub OIDC identity for publish
permission and attach provenance. `NPM_TOKEN` exists only as a documented
first-publication fallback and should be removed immediately afterward; JSR
never needs a stored token.

## Preparing A Release

1. Decide the SemVer bump from the public API, type contracts, generated output,
   and wire-format compatibility.
2. Update the version in both package manifests.
3. Move relevant entries from `Unreleased` into a dated changelog section.
4. Run the complete release gate.

```sh
pnpm release:check
pnpm format:check
pnpm lint:check
pnpm test
pnpm build
pnpm release:pack
pnpm release:jsr:dry-run
```

`release:pack` creates the real npm tarball in a temporary directory, rejects
TypeScript sources and tests, enforces an unpacked-size ceiling, installs the
tarball in an empty consumer project, and executes ESM, CommonJS, CLI, and MCP
stdio smoke tests. The JSR dry run validates the TypeScript-source distribution
separately.

## Tagging And Publication

Create an annotated tag only after the release commit is on `main`:

```sh
git tag -a v1.0.0 -m "release: v1.0.0"
git push origin main
git push origin v1.0.0
```

The tag starts `.github/workflows/release.yml`. The workflow verifies the full
repository, publishes npm and JSR in parallel, and creates a GitHub Release only
after both registries succeed. A failed registry publish leaves no successful
GitHub Release and can be retried from the same immutable tag after correcting
registry configuration. The npm job checks the exact package version first and
skips publication when that immutable version already exists, so a retry is
safe after npm succeeded but JSR or GitHub Release failed.

Never move or recreate a published tag. Published registry versions are
immutable. Fix a bad release with a new patch version.

## npm Distribution Versus JSR Distribution

npm receives built ESM, CommonJS, declarations, CLI entrypoints, and package
metadata. It excludes `src`, tests, benchmarks, docs-site code, and monorepo
tooling. This keeps installation smaller while supporting Node import and
require consumers.

JSR receives ESM TypeScript source and its public entrypoints. JSR performs its
own portability and type checks and generates documentation from source. Tests
remain excluded from the JSR package.

## Repository Metadata

`.github/labels.json` is synchronized automatically with the issue forms. The
description, features, and topics in `.github/repository.json` require a
fine-grained `GH_ADMIN_TOKEN` secret with repository Administration write
permission; run the **Sync repository settings** workflow manually after adding
that secret. Remove the secret after synchronization if ongoing automation is
not desired.
