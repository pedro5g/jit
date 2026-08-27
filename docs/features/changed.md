# Change masks

## 1. Problem

"Did anything I care about change, and what?" is asked constantly — before a re-render, before a save, before firing a webhook — and the usual answers are all wrong in some way. `left !== right` reports every rebuilt object as changed. A deep-equal answers yes/no but not *what*. And the shape people reach for when they need the detail is an object:

```ts
{ id: false, email: true, status: false, tags: false, profile: false }
```

which allocates an object and five booleans per comparison, to answer a question the caller almost always asks one field at a time.

## 2. Why JIT

The schema declares the fields and their types, so the set of watchable fields is fixed and finite at compile time. That makes a bit position per field a natural encoding, and it makes the comparison itself specializable: a scalar field is `!==`, a structural field defers to the equality already compiled for that field's own schema. Neither is a walker, and the result is a primitive.

## 3. API

```ts
const userChanged = JIT.compare.changed(User);
const mask = userChanged(before, after);

userChanged.has(mask, "email");
userChanged.fields; // ["id", "email", "status", …] in bit order
```

Watch a subset, including nested paths:

```ts
const profileChanged = JIT.compare.changed(User).select("status", "profile.name");
```

And decide watch updates by a subset rather than by reference:

```ts
JIT.watch(Users, { key: "id", fields: ["status"] });
```

## 4. Semantics

The mask has one bit per watched field, in the order the fields were named (or declaration order when none were). A bit is set when the two values differ at that field. Identical references return `0` without reading anything.

Scalars compare with `!==`, so `NaN` is reported as changed against itself — the same convention the rest of the library uses. Structural fields (arrays, objects, dates, maps) compare with that field's own compiled equality, so a rebuilt value with the same contents is *not* a change. A dotted path reads through a nullish parent safely: a parent going from an object to `null` sets the bit.

`has` returns `false` for a path that is not watched rather than throwing, and the type only admits watched paths.

## 5. Compilation

```
JIT.compare.changed(User).select(paths)
        ↓
ProjectionTree           ← the same selection projection and equal use
        ↓
one bit per leaf, leaves classified scalar or structural
        ↓
int32 mask (≤ 31 fields) or bigint mask
        ↓
compiled comparison, structural leaves bound to their own equality
```

## 6. Generated code

```js
function changed(left, right) {
  if (left === right) return 0;
  let mask = 0;
  if (left.id !== right.id) mask |= 1;
  if (left.email !== right.email) mask |= 2;
  if (!__changedEqual2(left.tags, right.tags)) mask |= 4;
  return mask;
}
```

One branch per field, static keys, no loop, no field-name string in the hot path.

## 7. Allocation model

Zero. The comparison returns a primitive, and `has` is a map lookup plus one bitwise `and`. Nothing is allocated per comparison, which is the point of choosing a mask over a result object.

## 8. Complexity

O(watched fields), and the constant is one comparison per field. `has` is O(1).

## 9. Physical strategies

| Field kind                       | Comparison                      |
| -------------------------------- | ------------------------------- |
| scalar (string, number, boolean…) | `!==` in place                  |
| structural (array, object, date) | that field's compiled equality  |

| Watched fields | Mask representation |
| -------------- | ------------------- |
| ≤ 31           | `number`            |
| > 31           | `bigint`            |

The widening is not a tuning choice. A `number` mask silently drops bit 32 and beyond, which would report a real change as no change — so the representation widens rather than answering wrongly.

## 10. AOT

The mask lowers to the comparison, the structural equalities it calls, and a `has` closing over the field order. No descriptor, no projection tree, no schema.

## 11. Runtime/AOT parity

`JIT.compare.changed` exists on `@jit-compiler/jit/runtime` and `@jit-compiler/jit/define` with the same signature, registers a reconstructive `changed-plan` artifact, and is covered by the runtime/define/AOT parity matrix. The generated declaration types `has` to accept only watched paths, and types the mask as `number` or `bigint` to match the representation that was chosen.

## 12. Benchmarks

The mask's claim is a shape claim rather than a speed claim: it answers *what changed* while allocating nothing, where the object-shaped alternative allocates per comparison. The comparison work itself is the same work `JIT.compare.equal().select()` does, and that is measured in [Projection](./projection.md) — selecting 2 of 9 fields is 2.5× faster than comparing the whole row because seven fields are never read.

Where a mask is genuinely faster than the alternatives is the case it exists for: asking about one field after comparing. `has(mask, "email")` is a map lookup and a bitwise `and`, against building and then reading a five-key object.

## 13. Tradeoffs

Bit order is positional, so it is part of the contract: reordering `select()` arguments changes what a stored mask means. Do not persist a mask across a schema change. Past 31 fields the representation becomes `bigint`, which is slower to combine and test than a small integer — if you have that many fields and care about the cost, watch a subset.

## 14. Best practices

Name the fields you actually act on with `select()` rather than taking every field by default; it is both faster and a clearer statement of intent. Use `JIT.watch(…, { fields })` when a collection's updates should be decided by a few meaningful fields instead of by reference — that is the common case for data that arrives rebuilt from the wire.

## 15. Non-goals

A mask says which fields differ, not how. For before/after values use [`JIT.compare.diff`](./diff), or `JIT.reconcile(…).changes("diff")` over a collection. It does not track changes over time, does not persist, and does not walk into arrays: an array field is one bit, compared by value as a whole.
