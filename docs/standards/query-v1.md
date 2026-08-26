# Query Standard V1

## Protocol

A static CQRS read query exposes a non-enumerable structural descriptor at
`query["~query"]`:

```ts
interface StandardQueryV1 {
  readonly version: 1;
  readonly definition: {
    readonly source: {
      readonly kind: "object";
      readonly fields: readonly string[];
    };
    readonly pipeline: readonly QueryStep[];
    readonly filter?: FilterExpression;
    readonly projection?: readonly string[];
    readonly order?: readonly {
      readonly path: readonly string[];
      readonly direction: "asc" | "desc";
    }[];
    readonly limit?: number;
    readonly params: readonly string[];
  };
}
```

`pipeline` is the ordered portable semantic query. V1 steps cover conditions,
projection, uniqueness, keyed/group collectors, ordering, incremental control,
mutation and scalar aggregation. Callback-backed scan updates remain named
bindings rather than embedded functions. The compatibility summary fields
`filter`, `projection`, `order`, and `limit` describe the effective common
read-query subset for simple adapters.

`FilterExpression` is a small recursive tree of `compare`, `logical`, and
`not` nodes. Values identify fields by path and can be literals, declared
parameters, or named query bindings. It contains no schema AST, compiled
function, execution plan, or JIT runtime object.

Successive static `where` clauses are represented as a left-associated logical
AND tree, matching their runtime execution. Parameter declarations accumulate
without losing earlier names; duplicate names are invalid. Static CQRS plans
retain their user-ordered semantics in `pipeline`. Repeated
projection/ordering declarations use the effective last value in compatibility
summary fields and repeated limits use the smallest summary bound.

`JIT.cqrs.input(...)` exposes the same versioned entry point, but its
definition describes _capabilities_ instead of a static request: permitted
filters, projection, sorting, pagination, and structural budgets. It is data
only and likewise contains no schema AST.

A filter capability set to `true` permits direct equality only. Operator
objects require an explicit, non-repeating operator list. Runtime and AOT
parsers reject non-object top-level input, unknown request keys, malformed or
repeated sort/select fields, and unsafe offset pagination.

The descriptor is an interoperability boundary, not a database adapter. An
application adapter may lower it to its own datastore query and must reject
operations it cannot faithfully represent. JIT never silently fetches all
rows and applies a CQRS query in memory as a fallback.

## Cursor requests

Dynamic input definitions may configure cursor pagination with a non-empty,
ordered `by` tuple. The parser encodes and decodes that tuple as an opaque
base64 value, validates its exact arity, accepts one of `after` or `before`,
and normalizes the request to the configured ascending ordering. This fixed
ordering makes the cursor stable across pages; an arbitrary request sort is
rejected instead of being silently combined with the cursor.

## Complexity bounds

Input definitions can bound `maxConditions` and `maxSortFields`. These are
structural limits, checked while the compiled parser is normalizing the
request, before an adapter allocates or lowers a datastore expression.

## Nested paths

Dynamic filters may declare and receive dotted object paths such as
`"profile.age"`. The public request always carries a path array, so the
transport spelling never leaks into an adapter: `"profile.age"` normalizes to
`["profile", "age"]`.

## Runtime and AOT

The in-memory callable still lowers through JIT's private `QueryProgram` and
specialized query compiler. That program is intentionally not part of this
standard and may evolve independently.

At an AOT boundary, a query is emitted from the private program as plain,
specialized JavaScript. The public `~query` data remains structural and
versioned so external code does not need to import JIT internals.
