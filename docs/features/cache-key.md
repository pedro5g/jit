# Cache keys

## 1. Problem

Almost every cache in a JavaScript codebase is keyed by the same line:

```ts
const key = JSON.stringify({ tenantId, id, version });
```

That does four things to answer a question about three fields: it allocates an intermediate object, walks it with a generic serializer, quotes and escapes every string, and produces a key whose stability depends on property insertion order. The fields were already known when the line was written.

## 2. Why JIT

The selection is known at compile time and the schema says what each field is. That turns the key into a fixed expression: three property reads and two concatenations, or three hash combinations and no string at all. There is nothing to walk and nothing to discover, so nothing generic needs to run.

## 3. API

```ts
const key = JIT.cacheKey.string(Row).select("tenantId", "id", "version");
key(row); // "t173"

const numeric = JIT.cacheKey.hash(Row).select("tenantId", "id", "version");
numeric(row); // 4188258
```

`JIT.cacheKey(Row)` is the string form.

## 4. Semantics

The key is built from the named fields, in the order named — so reordering the arguments produces a different key, by design. Strings are used as-is, numbers and booleans stringify directly, a `Date` becomes its timestamp, and a structural field is reduced through the schema's own hash rather than serialized.

Parts are separated by `U+0001`, which cannot appear in the JSON text of a field and keeps `("a", "bc")` from colliding with `("ab", "c")`. An absent optional is written as `U+0000`, so it stays distinguishable from an empty string.

The string form accepts at most one structural field and throws otherwise — a readable key over two hashed subtrees is neither readable nor cheaper than the hash form, so it points you at `hash` instead.

The hash form returns a 32-bit integer. It is a hash: distinct values can collide, so it is appropriate for a cache lookup that can afford a verification step or tolerate a miss, not for identity.

## 5. Compilation

```
JIT.cacheKey.string(Row).select(paths)
        ↓
ProjectionTree          ← the same selection projection and compare use
        ↓
one part per leaf, classified by the leaf's declared type
        ↓
string: a single concatenation expression
hash:   a fold, bound to the schema hash for structural leaves
```

## 6. Generated code

```js
function cacheKey(value) {
  return value.tenantId + "" + value.id + "" + value.version;
}
```

```js
function cacheKey(value) {
  let h = 23;
  h = ((h << 5) - h + __hashString(value.tenantId)) | 0;
  h = ((h << 5) - h + (value.id | 0)) | 0;
  h = ((h << 5) - h + (value.version | 0)) | 0;
  return h;
}
```

No `JSON.stringify`, no `Object.keys`, no intermediate object.

## 7. Allocation model

The string form allocates the key string and nothing else. The hash form allocates nothing at all — it never builds a string, which is what makes it 16× lighter in the measurements below.

## 8. Complexity

O(selected fields). The alternative is O(fields in the intermediate object) plus the cost of walking, quoting and escaping, which is why the gap is a multiple rather than a margin.

## 9. Physical strategies

| Declared type          | String form              | Hash form                       |
| ---------------------- | ------------------------ | ------------------------------- |
| string, literal, enum  | used as-is               | `__hashString`                  |
| number, boolean        | stringified directly     | coerced to an integer           |
| bigint                 | stringified directly     | low 32 bits                     |
| Date                   | `getTime()`              | `getTime() | 0`                  |
| object, array, Map, Set | the schema's hash       | the schema's hash               |
| optional / nullable    | `U+0000` when absent     | `0` when absent                 |

## 10. AOT

Both forms lower to the expression plus, when a structural field is selected, that field's specialized hash. The `__hash*` helpers are module-level, so several keys in one generated module share them.

## 11. Runtime/AOT parity

`JIT.cacheKey` exists on `@jit-compiler/jit/runtime` and `@jit-compiler/jit/define` with the same signature, registers a reconstructive `cache-key-plan` artifact, and is covered by the runtime/define/AOT parity matrix.

## 12. Benchmarks

Environment: Node 22.22.3, Apple M1, darwin-arm64, 10,000 rows of a 6-field schema, keys retained. Reproduce with `pnpm bench:cache-key`.

Three fields of six:

| Approach                             |      Time | Heap per call |
| ------------------------------------ | --------: | ------------: |
| `JSON.stringify` of a picked object  |   1.32 ms |       1.18 MB |
| `JSON.stringify` of an array         | 937.30 µs |       1.18 MB |
| handwritten template literal         | 364.51 µs |       1.34 MB |
| **`JIT.cacheKey.string` runtime**    | **321.37 µs** |   **1.34 MB** |
| **`JIT.cacheKey.string` AOT**        | **331.87 µs** |   **1.34 MB** |
| **`JIT.cacheKey.hash` runtime**      | **194.93 µs** |  **83.7 KB** |
| **`JIT.cacheKey.hash` AOT**          | **193.68 µs** |  **83.7 KB** |

The string form is about **4.0× faster** than the `JSON.stringify` line it replaces, and sits in the handwritten template-literal band. That gap is explainable rather than incidental: the serializer walks an object it did not need, quotes and escapes strings that did not need quoting, and the picked object is allocated only to be discarded.

The hash form is about **6.8× faster** and allocates **14× less**, because no key string is ever built. Runtime and standalone AOT are within measurement noise. If your cache is a `Map` and the key never has to be read by a human or crossed between processes, that is the form to use.

## 13. Tradeoffs

A hash key can collide; treat it as a bucket, not an identity. A string key embeds control characters, so it is stable and unambiguous but not pretty in a log — read `fields` order from the declaration if you need to decode one. Both encode field *order*, so a key stored under one selection is not comparable with a key from another.

Neither form is canonical across schema changes: adding a field to the selection changes every key, which is usually what you want and is occasionally a cache-invalidation event you have to plan for.

## 14. Best practices

Select the fields that actually identify the cached result — typically a tenant, an entity id and a version — and no more; every extra field is work per call and another reason for the key to change. Prefer `hash` for in-process `Map` caches and `string` when the key crosses a process boundary or is used in a log or a URL. Include a version field when the cached value's shape can change.

## 15. Non-goals

A cache key is not a hash of the whole value; use [`JIT.compare.hash`](./hash.md) for that. It is not a canonical serialization and does not round-trip — nothing reads a key back into a value. It does not manage a cache or evict anything; that decision belongs to the caller.

### There is deliberately no `JIT.memo`

A memoization wrapper was planned on top of this operation and was measured before being written. On 50,000 calls, with the key built by `JIT.cacheKey.hash`:

| Memoized function             | All hits: direct → memo | All misses: direct → memo |
| ----------------------------- | ----------------------: | ------------------------: |
| cheap (arithmetic)            |    0.58 ms → **0.89 ms** |      0.56 ms → **0.99 ms** |
| moderate (hash a short string) |    0.45 ms → **0.64 ms** |      0.67 ms → **0.89 ms** |
| expensive (40× that work)     |   10.27 ms → **0.65 ms** |     18.25 ms → **0.90 ms** |

Memoization only pays when the memoized function is genuinely expensive. For the cheap and moderate cases — which is what people reach for a memo helper for — it is 33–77% *slower*, because the key and the map lookup cost more than the work they avoid.

And where it does pay, there is nothing left for the library to specialize: the specialized part is the key, which is this operation, and the rest is three lines the caller writes with a `Map` they control the eviction of:

```ts
const key = JIT.cacheKey.hash(Row).select("tenantId", "id", "version");
const cache = new Map<number, Result>();

function compute(row: Row): Result {
  const k = key(row);
  const hit = cache.get(k);
  if (hit !== undefined) return hit;
  const value = expensive(row);
  cache.set(k, value);
  return value;
}
```

Publishing `JIT.memo` would have been a wrapper with no specialization of its own, and the plan's rule is that an operation must earn its place by avoiding work. This one does not, so it is not here.
