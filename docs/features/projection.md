# Projection

## 1. Problem

"Which fields does this operation actually touch" is a question four different parts of the library were answering separately: query `select()`, a standalone narrowing, a comparison that should ignore most of the row, and a cache key built from a few identifying fields. Each carried its own notion of a field list, which meant the fields you compared by were not provably the fields you projected.

For the caller, the everyday spelling is either a destructure repeated at each call site or a dynamic pick:

```ts
const out: Record<string, unknown> = {};
for (const key of ["id", "status"]) out[key] = row[key];
```

The dynamic form is the one that shows up when the field list is data rather than literal, and it is roughly five times slower than the static object literal it stands in for — a key loop, a megamorphic property read, and a dictionary-mode result object.

## 2. Why JIT

The schema already declares every field and its type, so a selection can be resolved once, at compile time, into a shape of its own. Once the selection *is* a schema, every emitter the library already has consumes it without learning anything new: `equal` over the projection's schema is a comparison of exactly the selected fields, `hash` over it is a hash of exactly those fields, and the projection literal is one static object expression.

That is what makes selective comparison nearly free to implement and impossible to drift: `JIT.compare.equal(User).select("id", "status")` is not a special comparison mode, it is the ordinary equality compiler pointed at a two-field schema.

## 3. API

```ts
const publicUser = JIT.project(User).select("id", "email");
const summary = JIT.project(User).select("id", "profile.name");
```

The same selection, used to compare:

```ts
const sameStatus = JIT.compare.equal(User).select("id", "status");
```

And over rows, through the query surface:

```ts
JIT.cqrs.query(Users).select("id", "email");
```

## 4. Semantics

A projection keeps the named fields and drops the rest, preserving field names and types — it is a subset of the same shape, not a transformation into another one. A dotted path narrows the nested object rather than pulling it whole: selecting `profile.name` keeps `profile` in the result with only `name` under it. A nullish parent stays nullish and is not read through. Naming a parent twice resolves it once.

Unknown keys and a catchall are dropped from the selection: a projection is exactly the fields it names, and inheriting either would let an operation reach a field the caller excluded. A path the schema does not declare throws at declaration.

`JIT.compare.equal().select()` compares only the named fields, so two values that differ elsewhere are equal.

## 5. Compilation

```
select("id", "profile.name")
        ↓
ProjectionTree   ← paths resolved against the schema, wrappers preserved
        ↓
      ┌─┴─────────────────────────┐
  tree.schema                 tree.nodes
      ↓                            ↓
existing emitters          object-literal emitter
(equal, hash, clone…)      (JIT.project, query select)
```

The tree carries both a canonical path list and the selection *as a schema*. Consumers that compare or hash take the schema and reuse the emitter they already had; consumers that build a value take the nodes.

## 6. Generated code

A projection is one object literal over static keys:

```js
function project(value) {
  return { "id": value.id, "profile": { "name": value.profile.name } };
}
```

A nullish parent short-circuits rather than being read through:

```js
function project(value) {
  return { "profile": value.profile == null ? value.profile : { "name": value.profile.name } };
}
```

And a selective comparison is simply an equality that never mentions the other fields:

```js
function equal(l, r) {
  if (l === r) return true;
  if (l.id !== r.id && (l.id === l.id || r.id === r.id)) return false;
  if (l.status !== r.status) return false;
  return true;
}
```

## 7. Allocation model

One result object per projected value, with a single hidden class because it is built at one site from a literal. No key array, no intermediate copy, no `delete` of fields that were copied and then removed. A selective comparison allocates nothing at all.

## 8. Complexity

Both forms are O(selected fields), not O(fields in the schema). That is the whole point of the selective comparison: comparing two rows by two fields costs two comparisons whether the row has nine fields or ninety.

## 9. Physical strategies

There is one shape. What varies is which access each leaf emits — a direct read, or a guarded read under a nullish parent — and, for a comparison, which equality the leaf's own type calls for.

## 10. AOT

Both lower to standalone functions with nothing else attached:

```js
const publicUser = /*#__PURE__*/ (function project(value) {
  return { "id": value.id, "profile": { "name": value.profile.name } };
});
const sameIdentity = (function equal(l, r) {
  if (l === r) return true;
  if (l.id !== r.id && (l.id === l.id || r.id === r.id)) return false;
  return true;
});
```

No schema, no tree, no projection engine. The selective comparison in particular carries no evidence that a projection was ever involved.

## 11. Runtime/AOT parity

`JIT.project` and `JIT.compare.equal().select()` exist on `@jit-compiler/jit/runtime` and `@jit-compiler/jit/define` with the same signatures and are covered by the runtime/define/AOT parity matrix. A selection registers as an ordinary operation artifact over the projection's schema, so it inherits the existing AOT emitter rather than adding one.

## 12. Benchmarks

Environment: Node 22.22.3, Apple M1, darwin-arm64, 10,000 rows of a 9-field schema, results retained. Reproduce with `pnpm bench:projection`.

Projecting 2 of 9 fields:

| Approach                | Time per 10k rows | Heap per call |
| ----------------------- | ----------------: | ------------: |
| dynamic pick loop       |         453.88 µs |        629 KB |
| idiomatic destructure   |          98.58 µs |        503 KB |
| handwritten literal     |         130.51 µs |        503 KB |
| **JIT project runtime** |      **44.50 µs** |    **503 KB** |
| **JIT project AOT**     |     **102.54 µs** |    **503 KB** |

Comparing by 2 of 9 fields, on pairs that agree on the selection and differ elsewhere:

| Approach                     | Time per 10k pairs |
| ---------------------------- | -----------------: |
| full `equal` (all 9 fields)  |          200.60 µs |
| handwritten 2-field compare  |           96.51 µs |
| **JIT runtime `equal().select()`** |       **59.33 µs** |
| **JIT AOT `equal().select()`** |        **112.82 µs** |

Two readings, and only one of them is a claim. The explainable result is the comparison row: selecting two fields out of nine is 3.4× faster at runtime (1.8× AOT) than comparing the whole row, because seven fields are never read — and against the dynamic pick loop, static keys replace a key loop and a dictionary-mode object with one literal.

The margin over the *handwritten* versions and the runtime/AOT spread are not claims. The emitted bodies are equivalent, but module boundary, inlining and escape-analysis decisions move this microbenchmark substantially; earlier runs have reversed the ranking. The stable claim is the avoided dynamic field loop and the avoided seven comparisons, not a runtime-versus-AOT ratio.

## 13. Tradeoffs

For one or two fields read once, a destructure at the call site is simpler and costs the same. A projection is worth compiling when the same selection is applied many times, when the field list is shared between operations, or when the alternative would be a dynamic key loop. Selecting nearly every field saves nothing and costs a declaration.

## 14. Best practices

Declare a selection once and reuse it for projecting and comparing, so the fields you compare by are provably the fields you expose. Prefer `select()` on the comparison over comparing full rows when only a few fields decide the answer — a "has this row meaningfully changed" check is the common case. Use `JIT.map` instead when the target has different names or computed fields; `project` is for a subset of the same shape.

## 15. Non-goals

A projection does not rename, compute, reorder or restructure — that is `JIT.map`. It does not project through arrays (`items[].name` is not a path); select the array whole and project its elements. It does not validate, and it does not deep-clone the values it keeps: an unselected object reached by a selected path is carried by reference.
