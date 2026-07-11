# Cache, Hash, And Index Strategies

JIT uses caches and strategy hints only where they remove real work. The goal
is not to add state everywhere; it is to specialize the few cases where cached
structure turns repeated or high-cardinality operations into cheap checks.

## Compile Cache

Compiled functions are cached by schema object identity:

- equal, clone, diff, update, hash, validator, mask, sanitize, serialize, and
  codec functions use a `WeakMap` keyed by schema;
- query and mapper compilers cache source templates but re-apply user bindings
  per compile.

This means:

```ts
const isUserA = JIT.validate(User).is().compile();
const isUserB = JIT.validate(User).is().compile();
```

can reuse compilation work for the same schema identity. If you rebuild a new
schema object, it is treated as a new compile target.

## How To Use It Well

Compile at module scope:

```ts
const isUser = JIT.validate(User).is().compile();

export function handle(input: unknown) {
  if (!isUser(input)) return null;
  return input;
}
```

Avoid compiling inside hot paths:

```ts
// Avoid this.
function handle(input: unknown) {
  return JIT.validate(User).is().compile()(input);
}
```

The cache will reduce repeated compile cost, but creating fluent builders and
closures inside a hot function is still unnecessary work.

## Hash Strategy

Use `.hash()` when a shape benefits from hash short-circuiting:

```ts
const User = JIT.object({
  id: JIT.number(),
  name: JIT.string(),
  tags: JIT.array(JIT.string()),
}).hash("ordered");

const equalUser = JIT.equal(User).compile();
const hashUser = JIT.hash(User).compile();
```

Hashing helps when:

- equality checks are repeated;
- objects are nested;
- arrays are large;
- most comparisons differ early at the hash level.

Generated AOT hash functions use a `WeakMap` cache for object/function inputs.
That cache is emitted only when hash is actually used. Primitive values bypass
the object cache.

## Why Hash Is Faster

Without a hash, equality may need to compare every field recursively. With a
hash hint, generated equality can compare hashes first:

```ts
if (__hash(left) !== __hash(right)) return false;
```

When hashes differ, the function avoids walking the whole object. When hashes
match, equality still checks the real structure, so hash is a short-circuit,
not a replacement for correctness.

## Why Hash Uses Less Memory

The hash cache is a `WeakMap`, so cached entries do not keep user objects alive.
It avoids repeated traversal without building permanent side tables. In AOT,
`__hashCache` is included only in generated files that need it.

## Index Strategy

Use entity/index hints for large arrays of keyed objects:

```ts
const User = JIT.object({
  id: JIT.number(),
  name: JIT.string(),
});

const Users = JIT.array(User).entity({ key: "id" }).indexBy("id");
const equalUsers = JIT.equal(Users).compile();
```

This tells equality that array identity is based on a stable key. For large
arrays, the generated code can build or reuse an index over the right-hand
array instead of doing an O(n²) scan.

## Why Index Is Faster

Without an index, comparing two arrays with reordered entities can require a
search for each left item. With an index:

```ts
const rightById = __getIndex(right, "id");
const match = rightById.get(leftItem.id);
```

Lookup becomes near O(1) per item. For large collections, that is the
difference between a nested scan and one pass plus map lookups.

## Why Index Uses Less Memory In Repeated Checks

The index cache is a `WeakMap` keyed by the array identity. Reusing the same
right-hand array lets generated equality reuse the map. When the array is no
longer referenced, the cached index can be collected.

In AOT output, `__indexCache` and `__getIndex` are emitted only when a selected
operation needs indexed equality. Plain validators and simple equality
functions do not carry index helpers.

## Best Practices

- Use `.hash()` for nested records and repeated equality checks.
- Use `.entity({ key }).indexBy(key)` for arrays with stable identity keys.
- Keep keys stable and unique.
- Do not add hash/index hints blindly to tiny data; direct comparison can be
  faster when the data is small.
- Prefer AOT for front-end bundles so unused hash/index helpers tree-shake out
  of routes that do not use them.
