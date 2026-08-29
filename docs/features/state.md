# Compiled State

## Problem and namespace

Immutable update, patch application, snapshot reconciliation and watching all
describe state evolution. Their canonical public home is `JIT.state`:

```ts
JIT.state.update(User);
JIT.state.patch.apply(User);
JIT.state.patch.merge(User);
JIT.state.patch.json(User);
JIT.state.reconcile(Users);
JIT.state.watch(Users, { key: "id" });
JIT.state.watchedList(Users, initial, { key: "id" });
```

The previous root operations are removed rather than retained as aliases. This
keeps one discoverable path and lets future collection mutation and derived
state share a coherent compiler vocabulary.

## Compiler and allocation model

The namespace is composition, not a runtime engine. Every member retains its
existing immutable descriptor and specialized emitter:

- update compares child results before rebuilding their parent;
- merge/apply patch rebuild only the changed spine;
- reconcile emits only requested result channels;
- watch indexes known identity fields directly;
- watched lists retain state explicitly in their instance.

An unchanged update returns the original root. A nested change allocates one
object per changed level and reuses unrelated branches. There is no Proxy or
generic path walker in compiled update code.

## Runtime, define and AOT

Runtime and define expose the same `state` keys. Update, patch, reconcile and
callback-free watch artifacts keep their reconstructive metadata and generate
the same standalone functions as before the namespace migration. Stateful
`watchedList` remains runtime infrastructure rather than an AOT function.

## Performance and tradeoffs

This namespace migration makes no speed claim and deliberately does not change
generated source. Existing measured claims remain with the individual
[Patch](./patch.md), [Reconcile](./reconcile.md), and
[Change mask](./changed.md) features. MutationPlan extraction requires a
regression benchmark against the current update emitter before its source may
change.

JIT does not implement Immer's `createDraft`, `finishDraft`, `current`,
`original` or `isDraft`. Those APIs belong to Proxy/draft discovery. JIT uses a
known schema and explicit mutation intent to compile copy-on-write code.

## Best practices and non-goals

- Compile state artifacts once and reuse them.
- Use `===` after updates to skip downstream work on no-ops.
- Select only reconciliation channels a caller consumes.
- Validate untrusted patches before applying them.
- History management, side effects and a reactive application framework are
  not responsibilities of `JIT.state`.

