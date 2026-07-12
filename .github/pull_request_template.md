## Summary

Describe the user-visible behavior and why this change is needed.

## Verification

- [ ] Runtime behavior is covered by tests.
- [ ] Public TypeScript behavior is covered with `expectTypeOf` or intentional `@ts-expect-error` cases.
- [ ] Generated source or AOT snapshots were reviewed when code generation changed.
- [ ] Performance claims include a reproducible benchmark and raw environment details.
- [ ] Documentation and changelog entries were updated when the public API changed.
- [ ] `pnpm format:check`, `pnpm lint:check`, `pnpm test`, and `pnpm build` pass.

## Compatibility

- [ ] No public API or type contract changes.
- [ ] Breaking changes are clearly identified and justified.
- [ ] Persisted codec or wire-format changes include an explicit versioning strategy.

## Generated Code

For compiler changes, include a short before/after excerpt or link to the updated snapshot. Explain allocation, cache, tree-shaking, and hot-loop consequences.
