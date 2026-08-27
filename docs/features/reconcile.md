# Reconcile

## 1. Problem

Comparing two snapshots of the same collection is everywhere — a list re-fetched from an API, a store rehydrated from cache, a document synchronised between peers — and the obvious spelling is quadratic:

```ts
for (const row of current) {
  const before = previous.find((candidate) => candidate.id === row.id);
  // …
}
const removed = previous.filter((row) => !current.some((c) => c.id === row.id));
```

That is O(n·m), and it is not even the worst part. The rows almost always arrive as new objects, so a reference check reports everything as changed; comparing by value means hand-writing a per-field comparison, or reaching for a generic deep-equal that walks a shape it knows nothing about. And it produces four arrays whether or not the caller wanted four.

## 2. Why JIT

The collection already declares its identity (`.keyed("id")`, `.entity()`, `.uniqueBy()`), and the row schema already describes exactly which fields exist and what type each one is. That is everything a reconciliation needs: identity to match on, and a specialized equality to decide whether a matched pair actually differs. Both come from the same declaration, and both compile to straight-line code with no walker.

It also makes the result a compile-time decision rather than a runtime one. A caller who only wants additions is asking a strictly smaller question, and the compiler can answer it with a strictly smaller loop.

## 3. API

```ts
const reconcileUsers = JIT.reconcile(Users);
const result = reconcileUsers(previous, current);
// { added, removed, changed, unchanged }
```

Name the identity when the collection declares none, or to override it:

```ts
JIT.reconcile(Users).by("email");
```

Ask for fewer channels:

```ts
JIT.reconcile(Users, { unchanged: false });
```

Attach a structural diff to each changed pair:

```ts
JIT.reconcile(Users).changes("diff");
// changed: [{ before, after, diff }]
```

Stream results instead of collecting them:

```ts
JIT.reconcile(Users).to.iterator();
JIT.reconcile(Users).to.visitor();
```

## 4. Semantics

A row in `current` whose identity is absent from `previous` is **added**. An identity in `previous` never matched by `current` is **removed**. A matched pair is **unchanged** when the rows are the same reference or compare equal by value, and **changed** otherwise. `changed` reports `{ before, after }`, plus `diff` when `changes("diff")` was declared.

Equality is `JIT.compare.equal` for the row, so a snapshot rebuilt from JSON with identical values reports as unchanged rather than as a wholesale replacement. A `Date` identity is matched by timestamp. Where the same identity appears twice in `current`, the first occurrence matches and the second is an addition. Result order follows `current` for the matched channels and the previous snapshot's insertion order for `removed`.

A channel that is turned off is absent from the result type as well as the result object.

## 5. Compilation

```
JIT.reconcile(Users, channels).changes(mode).to.sink()
        ↓
ReconcileDescriptor   ← identity, channels, change mode, sink
        ↓
one emitted loop, with only the branches the channels can reach
        ↓
bound to compiled equal(Row) — and diff(Row) only when declared
```

The channels are resolved at compile time, so they are not flags the generated code tests; they decide which code exists.

## 6. Generated code

All four channels:

```js
function reconcile(previous, current) {
  const index = new Map();
  for (let i = 0, len = previous.length; i < len; i++) {
    const previousItem = previous[i];
    index.set(previousItem.id, previousItem);
  }
  const added = [];
  const removed = [];
  const changed = [];
  const unchanged = [];
  for (let i = 0, len = current.length; i < len; i++) {
    const item = current[i];
    const id = item.id;
    const previousItem = index.get(id);
    if (previousItem === undefined) {
      added[added.length] = item;
    } else {
      index.delete(id);
      if (previousItem === item || __reconcileEqual(previousItem, item)) {
        unchanged[unchanged.length] = item;
      } else {
        changed[changed.length] = { before: previousItem, after: item };
      }
    }
  }
  for (const previousItem of index.values()) {
    removed[removed.length] = previousItem;
  }
  return { added, removed, changed, unchanged };
}
```

The same declaration asking only for removals compiles to this instead — no equality, and one map lookup per row rather than two, because `delete` already answers what `get` would have:

```js
function reconcile(previous, current) {
  const index = new Map();
  for (let i = 0, len = previous.length; i < len; i++) {
    const previousItem = previous[i];
    index.set(previousItem.id, previousItem);
  }
  const removed = [];
  for (let i = 0, len = current.length; i < len; i++) {
    const item = current[i];
    index.delete(item.id);
  }
  for (const previousItem of index.values()) {
    removed[removed.length] = previousItem;
  }
  return { removed };
}
```

## 7. Allocation model

One `Map` over the previous snapshot, plus one array per requested channel and one `{ before, after }` object per changed pair. Nothing else: no key strings, no closures per row, no intermediate result. A channel that is off allocates nothing and is not appended to; `removed` being off also removes the `delete` and the final walk. The visitor sink allocates no arrays at all, and the iterator sink allocates only the event it yields.

## 8. Complexity

```
nested find:  O(n · m)
reconcile:    O(n + m)
```

The index is built once over `previous`, `current` is read once against it, and what the index still holds at the end is exactly what was removed — so nothing is searched twice and the removal set costs no extra pass over either input.

## 9. Physical strategies

Reconcile has one shape, chosen by the request rather than by the data: which branches exist follows from the channels, the change mode and the sink. What varies with the schema is the identity read (direct field or `Date` timestamp) and the compiled equality bound into the loop.

## 10. AOT

The declaration is identical and the generated module is standalone: the loop, the specialized `equal` for the row, and the specialized `diff` only when `changes("diff")` was declared. No JIT import, no schema walker, no diff engine, no channel switches — and an equality nothing can reach is not emitted at all, so a reconciliation that only reports additions ships no comparison code.

## 11. Runtime/AOT parity

`JIT.reconcile` exists on `@jit-compiler/jit/runtime` and `@jit-compiler/jit/define` with the same signature, registers a reconstructive `reconcile-plan` artifact, and is covered by the runtime/define/AOT parity matrix. All four sinks — result, iterator, visitor, and the diff variant — are verified to produce byte-identical results between runtime and generated code.

## 12. Benchmarks

Environment: Node 22.17.1, Linux x64, AMD Ryzen 7 5800H, benchmark-runner warmup and adaptive iterations. Reproduce with `pnpm bench:reconcile`. Each `current` snapshot holds all-new object references, so a reference comparison would report every row as changed; the percentage is how many rows actually differ in value.

Against the shape it replaces, at 50% changed:

| Rows    | Nested find | Handwritten | JIT runtime | JIT AOT |
| ------- | ----------: | ----------: | ----------: | ------: |
| 100     |    10.03 µs |     5.53 µs |     5.62 µs | 5.62 µs |
| 1,000   |   850.05 µs |    50.36 µs |    54.68 µs | 51.12 µs |
| 10,000  |           — |     1.26 ms |     1.25 ms | 1.26 ms |
| 100,000 |           — |    19.93 ms |    20.63 ms | 20.06 ms |

The nested scan is not run past 1,000 rows because it is quadratic; that is the point of the row. Between 100 and 1,000 rows it grows 85× while the compiled reconciliation grows 10×.

Across change ratios at 100,000 rows, runtime and AOT track the handwritten ceiling within measurement noise:

| Changed | Handwritten | JIT runtime | JIT AOT |
| ------- | ----------: | ----------: | ------: |
| 0%      |    18.88 ms |    19.62 ms | 18.78 ms |
| 1%      |    18.00 ms |    18.18 ms | 19.12 ms |
| 10%     |    18.51 ms |    18.66 ms | 18.85 ms |
| 50%     |    19.93 ms |    20.63 ms | 20.06 ms |
| 100%    |    23.32 ms |    22.97 ms | 24.00 ms |

What narrowing the request is worth, on 10,000 rows at 50% changed:

| Request               |     Time | Heap per call |
| --------------------- | -------: | ------------: |
| all four channels     |  1.27 ms |       1.90 MB |
| added channel only    | 815 µs   |     922 KB    |
| visitor sink          |  1.23 ms |       1.40 MB |

Asking for one channel instead of four is 36% faster and allocates 52% less, because the comparison and three of the arrays are not in the compiled function at all. The visitor sink costs the same time and 26% less memory, since it never builds a result.

These are ceiling-matching figures, not a speedup claim against careful handwritten code: the claim is that you get that code from a declaration, and that narrowing the declaration narrows the code.

## 13. Tradeoffs

For very small collections the `Map` costs more than a nested scan saves; the crossover in these measurements is around 100 rows. Identity must be genuinely unique — duplicate identities in `current` are reported as additions, which is defensible but may not be what a caller expects from malformed data. Value equality reads every declared field, so for very wide rows where a version field already settles the question, comparing that field with a narrower schema is cheaper.

## 14. Best practices

Declare identity on the collection (`.keyed("id")`) rather than repeating `.by("id")` at every call site. Turn off channels you do not read — it is the single largest lever here. Reach for `.to.visitor()` when the results are consumed immediately and never stored, and for `.changes("diff")` only when a caller actually renders the field-level difference, since the diff is extra work on exactly the rows that changed.

## 15. Non-goals

Reconcile compares two snapshots by identity. It does not track changes over time, hold state between calls, or subscribe to anything — that is `JIT.watch` and `JIT.watchedList`. It does not merge, resolve conflicts, or produce a patch to apply; `changes("diff")` reports what differs and stops there. It does not reorder, and it does not detect a move as anything other than the identity staying put.
