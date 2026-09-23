# Runtime environments, errors, and metadata

`JIT.config({ locale })` changes the default observable presentation context.
`JIT.create({ locale })` returns an isolated facade that shares implementation
code but owns its registry and extension set. Compiled functions capture the
resolved context at compilation time.

Validation issues have a stable structural identity (`code`, `path`, and
`params`); `message` is presentation. The helpers below are intentionally
outside generated success paths:

```ts
JIT.error.format(error);
JIT.error.flatten(error);
JIT.error.tree(error);
JIT.error.pretty(error);
```

`JIT.locales.enUS` and `JIT.locales.ptBR` implement the small `ErrorLocale`
contract. Applications can provide an adapter to their i18n system without
adding an i18n dependency to JIT.

Descriptive metadata is stored in typed registries. `.meta()` uses the active
environment's global registry, while `.register(registry, value)` writes to an
explicit registry. Registry IDs are unique within each registry. Metadata is
available to descriptive outputs such as JSON Schema, but does not alter the
executable compilation contract by default.
