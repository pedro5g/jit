# Patch

## 1. Problem

"Apply a patch" names three different contracts, and they disagree about the thing that matters most: what `null` means.

- A deep partial patch, where a missing member means "leave alone".
- RFC 7396 JSON Merge Patch, where `null` means "remove this member".
- RFC 6902 JSON Patch, where the patch is a list of operations against JSON Pointers.

Code that treats them as interchangeable deletes fields it meant to keep. Grouping them under one namespace with three explicit names is the point: you have to say which contract you are implementing.

## 2. Why JIT

For merge patch, a great deal. The generic algorithm walks the patch with `Object.keys` and recurses on whatever it finds; the schema already says which members exist and which are objects worth recursing into, so the walk becomes a fixed sequence of static-key checks and the recursion becomes a direct call to a named function.

For JSON Patch, honestly: not much. A pointer is a string that arrives with the patch, so it has to be parsed and walked at run time. This exists for interoperability and for AOT — the generated module carries the whole implementation with no JIT dependency — not because compiling it makes it faster. The plan's rule is to say so rather than imply a speedup that is not there.

## 3. API

```ts
JIT.patch.apply(User);  // deep partial; undefined means "leave alone"
JIT.patch.merge(User);  // RFC 7396; null removes
JIT.patch.json(User);   // RFC 6902; a list of operations
```

`JIT.patch.apply` is `JIT.update` under the patch namespace — the same compiled plan and the same registered artifact, reached by a second name because it belongs in this group.

## 4. Semantics

**apply** — a deep partial patch. A member set to `undefined` is left alone; arrays are patched positionally; Dates, Sets and Maps are replaced wholesale.

**merge** (RFC 7396) — a patch that is not an object replaces the target outright. A member set to `null` is removed. An object member is merged recursively; an array member is replaced. Members the schema does not declare are ignored rather than added, which is where a schema-aware implementation deliberately departs from the generic one.

**json** (RFC 6902) — `add`, `remove`, `replace`, `move`, `copy` and `test`, applied in order. Pointer segments unescape `~1` to `/` and `~0` to `~`. `add` on an array index inserts; `-` appends. `test` compares structurally and throws naming the pointer when it fails. An unknown `op` throws.

All three are immutable and share unchanged substructure. `merge` and `apply` return the original value by reference when nothing changed, so a caller can use `===` to skip work downstream.

## 5. Compilation

```
JIT.patch.merge(User)
        ↓
one function per object level, named after its path
        ↓
static-key checks per declared member, direct calls between levels

JIT.patch.json(User)
        ↓
the operation switch, plus pointer helpers emitted once per module
```

## 6. Generated code

Merge patch, one level:

```js
function mergePatch_address(value, patch) {
  if (patch === null || typeof patch !== "object" || Array.isArray(patch)) return patch;
  let changed = false;
  const out = {};
  if ("city" in patch) {
    if (patch.city === null) {
      changed = true;
    } else {
      out["city"] = patch.city;
      if (!Object.is(value.city, patch.city)) changed = true;
    }
  } else if ("city" in value) {
    out["city"] = value.city;
  }
  return changed ? out : value;
}
```

No `Object.keys`, no `for…in`, and the nested level is reached by name rather than by recursing on a runtime type check.

## 7. Allocation model

`merge` allocates one object per level that actually changed, and returns the original by reference for levels that did not — so patching one field of a deeply nested document rebuilds the spine and nothing else. `json` copies each level along the pointer's path, which is inherent to applying a pointer immutably.

## 8. Complexity

`merge` is O(declared members per level), the same as the generic algorithm but with the constant of a static-key check rather than a dynamic one, and with no key array allocated per level. `json` is O(operations × pointer depth).

## 9. Physical strategies

| Member kind             | Merge behavior                    |
| ----------------------- | --------------------------------- |
| object                  | direct call to that level's merge |
| array, Date, Set, Map   | replaced wholesale                |
| scalar                  | assigned, compared with `Object.is` |
| `null` in the patch     | removed                           |

## 10. AOT

`merge` lowers to its nested functions and nothing else. `json` lowers to the operation switch plus the pointer helpers, emitted once per module and shared by every JSON Patch in it. Neither imports JIT.

## 11. Runtime/AOT parity

All three exist on `@jit-compiler/jit/runtime` and `@jit-compiler/jit/define` with the same signatures. `merge` and `json` register reconstructive `patch-plan` artifacts; `apply` registers the update artifact it already was. All are covered by the runtime/define/AOT parity matrix.

## 12. Benchmarks

No performance claim is made for `JIT.patch.json`: it walks a runtime pointer, and a hand-written pointer walker does the same work. It is here for the RFC contract and for the AOT property that the generated module needs no library.

`JIT.patch.merge` is the one with a compiled advantage, and the shape of it is the same one measured for [Projection](./projection.md): replacing dynamic key iteration with static-key checks. The library's own `pnpm bench:ops` covers the update plan that `apply` reuses.

If you need a number before adopting `merge` in a hot path, measure it against your own patches with `pnpm bench:ops` as a template — patch shape (how many members are present, how deep) dominates, and a synthetic average would not tell you much.

## 13. Tradeoffs

Merge patch cannot express "set this member to null" — that is what removal means in RFC 7396, and it is why the contract is not a general-purpose update. Use `apply` when you want a partial assignment, and `json` when you need to distinguish an explicit null from an absence. JSON Patch's `move` and `copy` read the document as it stands after earlier operations in the same list, which is per the RFC but surprises people.

## 14. Best practices

Pick the contract by what the *sender* means, not by what is convenient to consume: an HTTP `PATCH` with `Content-Type: application/merge-patch+json` is `merge`, `application/json-patch+json` is `json`, and an internal partial update is `apply`. Do not mix them behind one endpoint.

## 15. Non-goals

There is no `JIT.patch.math`. Atomic increment/decrement operators were considered and deferred: they would lower to the update plan and add API surface without avoiding work, allocations or a pass over the data, which is the bar this library sets for a new operation. They will be revisited only with a benchmark that shows a difference.

Patch does not validate the result against the schema — compose it with `JIT.validate` if a patch may arrive from an untrusted source. It does not produce patches; use [`JIT.compare.diff`](./diff.md) or `JIT.reconcile(…).changes("diff")` for that direction.
