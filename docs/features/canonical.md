# Canonical

## 1. Problem

Two objects with identical fields in different insertion order are the same value to a reader and a different value to anything that walks keys — `JSON.stringify`, a hand-built cache key, a structural hash that trusts key order. Data that has been through a `{ ...spread }`, a merge, a deserializer or a database driver routinely comes back in an order nobody chose.

The usual fix is to sort keys before serializing, which allocates an array of keys and a new object on every value, whether or not anything was out of order.

## 2. Why JIT

The schema already declares the canonical order — it is the order the fields were written in. So canonicalizing is not a sort, it is a rebuild in a fixed order, and more importantly it is *checkable*: the generated function can compare the value's key order against the known one and return the value untouched when it already matches.

That check is what makes the common case free of allocation, and it is only possible because the expected order is a compile-time constant.

## 3. API

```ts
const canonical = JIT.canonical(Row);
const stable = canonical(row);
```

## 4. Semantics

Fields are placed in the order the schema declares them, recursively for nested objects. A value already in that order is returned **by reference**, and so is a nested object already in order even when its parent is rebuilt. A non-object passes through untouched.

Canonicalization does not clone: unselected structure is carried by reference, and only the objects whose order was wrong are rebuilt. Arrays are not reordered — element order is data, not representation.

## 5. Compilation

```
JIT.canonical(Row)
        ↓
one function per object level
        ↓
key-order check against the declared order, then a literal in that order
```

## 6. Generated code

```js
function canonical(value) {
  if (value === null || typeof value !== "object") return value;
  const keys = Object.keys(value);
  let canonical = keys.length === 3 && keys[0] === "id" && keys[1] === "name" && keys[2] === "meta";
  const next_meta = canonical_meta(value.meta);
  if (next_meta !== value.meta) canonical = false;
  if (canonical) return value;
  return {
    "id": value.id,
    "name": value.name,
    "meta": next_meta,
  };
}
```

No sort, no loop over the result, and the nested level is reached by name.

## 7. Allocation model

Nothing at all when the value is already canonical — the input comes back. Otherwise one object per level that was out of order; levels that were already correct are shared by reference.

## 8. Complexity

O(fields per level), plus the `Object.keys` call the check needs. The rebuild path is the same cost as the naive rebuild; the check path trades one `Object.keys` for the whole allocation.

## 9. Physical strategies

There is one strategy, and its interesting property is the early exit. What varies with the schema is how many levels exist and which of them contain nested objects worth checking.

## 10. AOT

Lowers to the nested functions and nothing else — no schema, no key table, no sort.

## 11. Runtime/AOT parity

`JIT.canonical` exists on `@jit-compiler/jit/runtime` and `@jit-compiler/jit/define` with the same signature, registers a reconstructive `canonical-plan` artifact, and is covered by the runtime/define/AOT parity matrix.

## 12. Benchmarks

Environment: Node 22.17.1, Linux x64, AMD Ryzen 7 5800H, 100,000 five-field objects per iteration.

| Input                    | Rebuild always | Check, then reuse |
| ------------------------ | -------------: | ----------------: |
| already canonical        |        4.59 ms |       **3.41 ms** |
| every value out of order |    **5.60 ms** |           8.23 ms |

The result is deliberately two-sided and worth reading carefully. When values are already canonical — which is the normal case for data your own code constructed — checking is 26% faster **and allocates nothing**, because the input is returned. When every value is out of order, checking is 47% *slower*: you pay for `Object.keys` and then rebuild anyway.

So this operation is a bet that most values are already in order. That bet is usually right, and where it is not — a stream of objects arriving from a source that reorders every one — you are better off rebuilding unconditionally with [`JIT.clone`](./clone.md), which is what that path costs without the check.

## 13. Tradeoffs

The check costs an `Object.keys` allocation, so canonicalizing a value you were going to rebuild anyway is worse than rebuilding it. Canonical order is the schema's declaration order, which means changing the order of fields in a schema changes every canonical form — plan for that if you persist serializations of canonical values.

This canonicalizes *representation*, not *value*: it does not normalize `-0` to `0`, trim strings, sort arrays or reorder a `Map`.

## 14. Best practices

Reach for it just before something that is sensitive to key order — a `JSON.stringify` you compare, a signature, a content-addressed store. Do not canonicalize defensively at every boundary; the operation is cheap only because it usually does nothing, and calling it where the value was already going to be rebuilt is pure cost.

For a cache key or a hash, do not canonicalize first: [`JIT.cacheKey`](./cache-key.md) and [`JIT.compare.hash`](./hash.md) read the declared fields directly and are already order-independent, so materializing a canonical form for them is work with no result.

## 15. Non-goals

Not a clone — unchanged substructure is shared. Not a normalizer — it does not change values, only their arrangement. Not a serializer, and not a sort: array order is preserved because array order is data.
