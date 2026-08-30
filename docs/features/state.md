# Compiled State

## Problem and namespace

Immutable update, patch application, snapshot reconciliation and watching all
describe state evolution. Their canonical public home is `JIT.state`:

```ts
JIT.state.update(User);
JIT.state.patch.apply(User);
JIT.state.patch.merge(User);
JIT.state.patch.json(User);
JIT.state.collection(Users);
JIT.state.reconcile(Users);
JIT.state.watch(Users, { key: "id" });
JIT.ddd.watchedList(Users, initial, { key: "id" });
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
`JIT.ddd.watchedList` remains runtime infrastructure rather than an AOT function.

## Declared patches

`update(Model)` accepts any deep-partial patch, so its compiled function has to
consider every field of every level it is handed. A patch declared in code is
known earlier than that, and lowers to a `MutationPlan` instead: normalized
writes, a read/write set, and a copy tree that says which levels have to be
rebuilt. See [Mutation Planner](./mutation-planner.md).

```ts
const renameUser = JIT.state
  .update(User)
  .patch({ name: JIT.cqrs.param("name") })
  .compile();
```

A path is specialized only when the generic update would assign its leaf; a
leaf the deep-partial update *merges* — an object, array, map, set or union —
keeps running through it, so a declared patch never changes meaning in order to
become faster. `explain()` reports which strategy it got.

## Collection mutations

`collection(Users)` mutates a collection immutably, and the algorithm that
finds the row comes from the collection's own facts rather than from the call:
a cached index for `.keyed()`, a binary search for `.ordered()` and unique, and
an early-exit scan otherwise. See
[State collections](./state-collections.md).

```ts
const renameUser = JIT.state
  .collection(Users)
  .updateByKey({ key: "id", patch: { name: JIT.cqrs.param("name") } });
```

`explain()` reports the chosen path and, separately, that rebuilding the array
is `O(n)` whatever found the row.

## Derived state

`derive(AppState).select(...)` declares what a computation reads, so its memo
can ask whether anything it reads changed rather than whether the input object
changed — and, given a mutation's change mask, answer without reading the state
at all. See [Derived state](./derived-state.md).

```ts
const selectHeader = JIT.state.derive(AppState).select("user.name", "user.status").memo();
```

## Performance and tradeoffs

The namespace migration itself made no speed claim and changed no generated
source. Existing measured claims remain with the individual
[Patch](./patch.md), [Reconcile](./reconcile.md), and
[Change mask](./changed.md) features. A declared patch is measured against the
generic update it specializes in
[Mutation Planner](./mutation-planner.md#performance).

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
