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

There are two cache tiers:

- Tier A caches an applied function for schema-only operations such as
  validation, equal, clone, diff, hash, serialization, masking, and sanitize.
- Tier B caches a pure source factory for queries and mappers, then applies
  external values and callbacks to a new closure for every compile. Bound
  values never leak between callers.

The cache uses weak schema keys. It does not keep an otherwise unreachable
schema alive, and it has no TTL or maximum-size configuration.

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

## Compile Cache Configuration

Caching is enabled by default. The supported public configuration points are:

```ts
JIT.validator(User, { is: true, parse: true, cache: false });
JIT.validator(User, { cache: false }).get("is", "parse");

JIT.mapper(Source, Target, overrides, { cache: false });
JIT.serializer(User, { cache: false });
JIT.codec(User, { version: 2, cache: false });
JIT.mask(User, { cache: false });
JIT.sanitize(User, { cache: false });
JIT.stream(User, { format: "ndjson", onItem, cache: false });

JIT.compileEqual(User.schema, { cache: false });
JIT.compileClone(User.schema, { cache: false });
JIT.compileHash(User.schema, { cache: false });
```

The same final options argument exists on the low-level validator selection,
diff, update, format, serialize, mask, sanitize, codec, mapper selection,
query, lazy iterator/visitor, and binary-query compilers. These are compiler
tooling boundaries; typed fluent factories remain the preferred application
API.

Use `cache: false` only for cold-compilation benchmarks, cache behavior tests,
or isolated compiler diagnostics. It bypasses one call and does not clear
existing entries. `Compiler.clearCompileCache()` resets the global store and
is reserved for deterministic tests and benchmark setup.

Validator operation selection is independent from caching:

```ts
const { is, parse } = JIT.validator(User).get("is", "parse");
```

This compiles only the requested operations and caches those operations. The
same principle applies to `JIT.mapper(...).get("map", "many")`.

Codec `version` is included in the cache key, so incompatible wire versions
cannot share an applied codec. Stream instances never share parser buffers,
items, or callbacks; only their compiled validation helper may be reused.

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

The runtime hash cache is keyed by object reference and has no invalidation
operation. In-place mutation after the first hash returns a stale cached value.
Use immutable replacements:

```ts
// Unsafe after the object was hashed.
user.profile.name = "Grace";

// Safe: changed nodes receive new references and new hashes.
const updated = {
  ...user,
  profile: { ...user.profile, name: "Grace" },
};
```

The strategy names accepted by `.hash(strategy)` currently select the same
structural hash short-circuit. They are descriptive hints, not separate
identity/reference hash algorithms.

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

The three schema annotations have distinct contracts:

| API                      | Identity        | Indexed equality | Unique-key intent |
| ------------------------ | --------------- | ---------------- | ----------------- |
| `.entity({ key: "id" })` | yes             | no               | no                |
| `.indexBy("id")`         | lookup identity | yes              | no                |
| `.keyed("id")`           | yes             | yes              | yes               |

`.entity()` alone supplies a default key to `compileNormalize`,
`compileUniqueBy`, and the sort fallback, but compiled array equality remains
positional. `.indexBy()` activates the adaptive map strategy. `.keyed()` is the
complete shorthand and also stores entity/cache/uniqueness metadata.

The uniqueness hint is not a validator. Duplicate keys overwrite earlier
entries when a map is built. Query `.keyed("id")` is a separate collector that
returns a fresh `Map` on every call; it does not read or install the schema
index cache.

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

Generated equality uses an adaptive threshold. Collections shorter than 64
items stay on a direct scan and do not allocate a `Map`; collections with 64
items or more build or reuse the keyed index. The cache stores one index key
per array reference, so alternating different keys for the same array rebuilds
the cached map.

An indexed array is subject to the same immutable-reference contract as a
hashed object. `push`, `splice`, reordering, and mutating a key field can make
the retained index stale. Produce a new array whenever data or identity keys
change. Keys must also be unique; duplicate keys are ambiguous and the last
entry wins during map construction.

For collections already sorted by a stable key, `.ordered("id", "asc")`
selects binary-search equality and avoids map allocation. It assumes the
runtime data really follows the declared order; it does not sort the input.

## Query Results And Application Caches

JIT caches query source templates, not query results. Every invocation runs
the generated loop again. Query `.keyed("id")` returns a `Map` as its result;
it does not retain that result for later invocations.

Application-level memoization remains an application concern:

- key by input reference when collections are immutable and reused;
- key by a domain version when one already exists;
- use structural hash to choose a bucket and compiled equality to confirm a
  match when equivalent values may have different references;
- define application-specific size, TTL, and eviction limits.

`JIT.watchedList()` can drive invalidation for incrementally edited
collections. It does not automatically invalidate hashes, compile caches, or
application results. Read `isChanged()` or the change arrays from `snapshot()`
and invalidate affected application keys explicitly.

## AOT Cache Behavior

AOT modules do not ship the runtime compiler cache: compilation already
happened during generation. Hash/index helpers are emitted only when the
selected generated operation needs them, so validator-only front-end modules
do not carry `__hashCache`, `__indexCache`, or generic runtime compiler code.

This distinction is important for bundle size. Runtime selection avoids
compiling unused operations; AOT selection additionally lets the bundler remove
unused operation modules and their private helpers.

## Best Practices

- Use `.hash()` for nested records and repeated equality checks.
- Use `.entity({ key }).indexBy(key)` for arrays with stable identity keys.
- Keep keys stable and unique.
- Treat hashed objects and indexed arrays as immutable.
- Keep `cache: false` and `clearCompileCache()` out of request paths.
- Do not assume compiled queries cache their returned values.
- Do not add hash/index hints blindly to tiny data; direct comparison can be
  faster when the data is small.
- Prefer AOT for front-end bundles so unused hash/index helpers tree-shake out
  of routes that do not use them.
