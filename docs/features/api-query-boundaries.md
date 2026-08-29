# API Query Boundaries

## Problem

`JIT.cqrs.query` describes trusted application code. A filter assembled from
HTTP input is different: it is a small program supplied by someone outside the
application and must not inherit every field or operation the schema can
express.

`JIT.api.query` declares that public capability as an explicit allowlist. It is
deny-by-default and compiles a parser; it does not create another query engine.

## API and semantics

```ts
const UsersQuery = JIT.api.query(User, {
  filter: {
    id: true,
    status: ["eq", "neq"],
    createdAt: ["gte", "lte"],
  },
  select: ["id", "status", "createdAt"],
  sort: ["createdAt", "id"],
  pagination: {
    type: "cursor",
    by: ["createdAt", "id"],
    defaultLimit: 20,
    maxLimit: 100,
  },
  limits: {
    maxConditions: 20,
    maxSortFields: 2,
    maxSelectFields: 8,
    maxDepth: 3,
  },
});

const parseUsersQuery = JIT.api.parse(UsersQuery);
const request = parseUsersQuery(httpQuery);
```

Only declared filter paths and sort fields exist to the request. `true` is the
conservative equality-only shorthand. An operator object must name an
explicitly listed operator. Unknown top-level keys, fields and operators are
rejected rather than silently removed. Projection has its own explicit
allowlist and remains bounded independently from the model shape.

The operator type is shared with the Query AST rather than copied into an API
registry. Ordered scalar fields support `eq`, `neq`, `gt`, `gte`, `lt` and
`lte`; booleans support only `eq` and `neq`. Objects and collections cannot be
exposed as flat scalar filters. Operations such as `in`, `between`,
`startsWith` and `contains` are not accepted until the shared Query AST and all
of its lowerings support them.

Relations, collection predicates and logical input are not inferred from a
nested schema and are not exposed in the current boundary.

## Structural limits

Declaration is the primary boundary; the limits are the last global stop.

| Limit | Default | Enforced |
| --- | --- | --- |
| `maxFilters` | 32 | request filter keys |
| `limits.maxConditions` | `maxFilters` | conditions produced by the request |
| `limits.maxSortFields` | 3 | requested sort fields |
| `limits.maxSelectFields` | 30 | requested projection fields |
| `limits.maxDepth` | 3 | declared filter path segments |
| `pagination.maxLimit` | required | requested page size |
| `pagination.maxOffset` | 10000 | computed offset of an offset page |

`maxDepth` is checked while the boundary is resolved, so a path deeper than the
budget fails at declaration rather than per request. Every other limit is
checked while the request is normalized.

Offset pagination is bounded by default because a deep page is the cheapest
amplification an external consumer can ask for: the boundary refuses
`page=1000000` before an adapter is given the chance to scan for it. Prefer
cursor pagination when an endpoint is expected to be paged deeply at all.

## Compilation and allocation

The boundary is resolved once against the schema. Runtime parsing uses a
specialized function containing direct field and operator branches. It checks
top-level keys, filters, conditions, projection, sorting, pagination and the
offset budget while normalizing the request. Invalid input exits through the
first failing check.

Resolution produces an immutable internal `QueryBoundary` with normalized
field paths, operator sets, projection, sorting, pagination and structural
limits. Relation, collection and logical capabilities are present in the IR
but closed in the current API. The descriptor is the only argument the runtime
and AOT source emitters take, so a limit cannot reach one parser and miss the
other; it is consumed before the normal Query AST or physical planner sees the
request.

Successful parsing allocates only the semantic output it returns: condition,
sort, projection and pagination data. It does not allocate an operator registry
or walk the schema. Complexity is O(request keys + requested conditions); the
configured limits bound both terms before an adapter receives the request.

## Runtime, define, AOT and `~query`

`JIT.api` has the same `query`/`parse` surface on runtime and define hosts. The
definition and parser register reconstructive artifacts. AOT emits an
import-free parser and the V1 structural descriptor; no builder, schema walker
or JIT import remains.

The boundary descriptor is consumed before query optimization. Parsed
conditions normalize to the shared query representation. The structural
`~query` protocol remains version 1 and receives no boundary, access or
physical-plan node.

## Performance and tradeoffs

The existing CQRS boundary benchmark remains reproducible with
`pnpm bench:cqrs`: on the recorded Ryzen 7 5800H run, the specialized dynamic
request parser averages about 219 ns and 43 bytes of heap for the flat fixture.
That figure is not a datastore-cost estimate; it measures syntax validation and
normalization only. The benchmark will move under the API boundary suite when
the semantic cost model lands.

The current object input is deliberate: HTTP frameworks commonly provide an
already parsed record. Raw query-string streaming is not implemented without a
benchmark showing that it avoids material work.

## Best practices and non-goals

- Declare the smallest field/operator surface an endpoint needs.
- Prefer cursor pagination for high-volume endpoints.
- Keep trusted predicates in `JIT.cqrs.query`; do not route them through the
  public parser.
- Treat limits as amplification guards, not as estimates of database cost.
- Dynamic database-loaded rule languages and storage-specific adapters are not
  part of this boundary.
