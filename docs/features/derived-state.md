# Derived State

## Problem

Memoization normally asks: **did the input change?**

```ts
if (state === previousState) return cached;
```

That question is cheap and wrong more often than it looks. Any immutable update
produces a new state object, so a selector over `user.name` is invalidated by a
change to `cart.items` it never reads.

A derived computation declares what it reads, so it can ask the narrower
question: **did anything this computation reads change?**

```ts
const userHeader = JIT.state.derive(AppState).select("user.name", "user.status");

userHeader.explain();
// { reads: ["user.name", "user.status"], layout: { paths: ["user", "cart"], ... }, mask: 1 }
```

The dependencies are inferred from the selection. There is no `dependsOn(...)`
to keep in sync with the computation.

## The memo

```ts
const selectHeader = userHeader.memo();
```

Three questions, cheapest first:

1. **Same state object?** One reference comparison.
2. **Does the change mask say nothing it reads moved?** Answered without
   reading the state at all.
3. **Did any dependency actually change?** Scalars by `!==`, structural fields
   by the schema's own compiled equality — never a deep comparison of the whole
   state, because the computation never reads the whole state.

Only then does it recompute. The cache holds a single previous result: a
selector needs the last state, not a history, and one slot keeps the memory
predictable. There is no global registry and no `WeakMap` keyed by state — each
memo owns its state in its own closure.

## The change-mask shortcut

`result.changed` from a mutation names the fields that moved. A derived
computation knows which bits it depends on, so the intersection answers without
touching the state:

```ts
const mutate = JIT.state
  .update(AppState)
  .patch({ cart: { items: JIT.cqrs.param("items") } })
  .result({ value: true, changed: true })
  .compile();

const result = mutate(state, { items: 9 });
selectHeader(result.value, result.changed); // cached: the mask names `cart` only
```

**The mask must describe the transition from the state the selector last saw.**
That is the shape a normal update loop already has — the selector sees state N,
the mutation takes N to N+1 and reports what moved, the selector is called with
N+1 and that mask. Feeding a mask from some other transition gives a wrong
answer, and nothing can detect that from a number.

What *can* be checked is the agreement the mask was produced against. Both sides
report their [`ChangeLayout`](./mutation-changes.md#change-layout):

```ts
selectHeader.accepts(mutate.layout()); // true — same path-to-bit agreement
```

Pass `{ layout }` to `derive()` to fix a non-default agreement.

## Performance

`pnpm bench:derive`, Ryzen 7 5800H, Node 22.

Per call, a two-scalar selector:

| Call | JIT memo | recompute always | memo by reference | reselect-style inputs |
| --- | --- | --- | --- | --- |
| same state reference | 1.7 ns | 6.5 ns | 0.58 ns | 0.96 ns |
| unrelated field changed | 1.9 ns | 6.6 ns | 2.0 ns | 0.97 ns |
| unrelated field changed, with mask | 1.8 ns | — | — | 0.97 ns¹ |
| dependency changed | 1.9 ns | 6.4 ns | — | 3.7 ns |

¹ has no mask to consult, so it reads the fields.

Read that table honestly. **A hand-written closure over two scalars beats the
compiled memo on the trivial paths.** Comparing two strings is already almost
free, so there is nothing for a mask to save, and a lexically-scoped closure
inlines into a micro-benchmark in a way a compiled one does not. Where the
compiled memo wins is where the comparison it replaces actually costs
something — recomputation (6.4 ns → 1.9 ns) and structural dependencies.

50 000 unrelated updates with a 64-element array dependency:

| | JIT memo + mask | handwritten structural comparison |
| --- | --- | --- |
| total | 685 µs | 948 µs |

End to end — 100 000 updates, nine in ten touching a field the selector does not
read, with a structural dependency:

| | total |
| --- | --- |
| JIT mutation + mask + derived memo | 2.2 ms |
| immutable update + reselect-style selector | 4.0 ms |
| immutable update + reference memo | 5.0 ms |

That is the number the feature is for: not a faster selector call, but
application work that never happens. (The first scenario in a run absorbs
warm-up; the figures above are the steady-state runs.)

## Runtime, define and AOT

A derived computation and its memo register reconstructive `derived-plan`
artifacts. `jit generate` emits the selector, the memo closure factory and the
structural equality helpers as one import-free module; no projection tree,
mapper runtime or change engine survives into the output. The generated memo
reports the same layout and accepts the same masks.

## Best practices and non-goals

- Select the fields the computation actually reads. That list *is* the
  dependency set; a wider selection memoizes worse.
- Pass the mutation's `changed` mask when you have one, and check
  `accepts(layout)` when it came from a different artifact.
- Prefer a derived computation where the dependency is expensive to compare or
  the computation is expensive to redo. For two scalars, a plain closure is
  fine — and this document would rather say so than sell you a table.
- A dependency graph across derived computations, and a reactive runtime that
  schedules them, are not part of this milestone. The primitives are the
  mutation's mask, the memo and `watch`; how they are wired together is an
  application decision.
