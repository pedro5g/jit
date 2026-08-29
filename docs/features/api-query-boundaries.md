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

## Semantic complexity budget

Counting conditions treats every condition as equal. `limits.maxCost` adds one
semantic budget on top, with conservative internal weights:

| Shape | Weight |
| --- | --- |
| scalar equality (`eq`, `neq`) | 1 |
| range (`gt`, `gte`, `lt`, `lte`) | 2 |
| ordering field | 3 |
| relation | 5 |
| collection predicate | 8 |

This is complexity, not database cost. It says how much work a request asks an
adapter to consider; it is not a PostgreSQL execution estimate and must not be
read as one. A backend may later add its own physical cost on top of it.

The default budget is exactly what the structural limits already permit, so an
unconfigured `maxCost` narrows nothing. `explain()` reports both numbers:

```ts
const UsersQuery = JIT.api.query(User, {
  filter: { id: true, age: ["gte", "lte"] },
  sort: ["name"],
  limits: { maxCost: 8 },
});

UsersQuery.explain();
// {
//   fields: [{ path: "id", operators: ["eq"], cost: 1 }, ...],
//   cost: { weights: { ... }, sort: 3, structural: 12, budget: 8 },
//   ...
// }
```

The budget is charged while the request is normalized, not afterwards, so a
request that breaks it stops at the condition that broke it and the remaining
request keys are never read. Because both budgets are static, a guard that
cannot fire is not emitted: when `maxCost` is the default, the generated parser
carries no cost counter at all and keeps the shape it had before the budget
existed.

## Compilation and allocation

The boundary is resolved once against the schema. Runtime parsing uses a
specialized function containing direct field and operator branches. It checks
top-level keys, filters, conditions, projection, sorting, pagination and the
offset budget while normalizing the request. The specialized function leaves at
the first failing check and does not continue building the request; on the
runtime host it then hands the request to the reference parser, whose job is to
produce the precise error. That costs a rejected request a second bounded pass,
which is the price of one place owning the error text — the import-free AOT
parser throws directly and pays no second pass.

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

## Authorization intersection

A boundary says what a consumer may express. Access says what one actor may
reach. The effective request is their intersection:

```ts
const readPosts = JIT.access(Post)
  .actor(Actor)
  .can("read", {
    fields: ["id", "authorId", "published"],
    when: (query, actor) =>
      query.or(query.eq("published", true), query.eq("authorId", actor.field("id"))),
  });

const authorizeListing = JIT.api.authorize(PostsQuery, readPosts, "read");
const effective = authorizeListing(httpQuery, actor);
```

The result is an ordinary request: the consumer's predicate and the actor's row
predicate joined with `and`, a projection narrowed to what both allowlists
permit, the ordering, and the pagination. **No access node reaches the
adapter** — the actor's own values arrive as literals, and the rules stay
behind.

The two boundaries fail differently, on purpose:

- a field the API never exposed is **rejected** — a request must not be
  silently corrected;
- a field the actor cannot read is **removed** from the projection, because
  not seeing it is the normal outcome of authorization;
- an ordering field the actor cannot read is **refused**: ordering by a hidden
  column reports on it;
- a filter over a field the actor cannot read is refused when the boundary is
  built, not per request. Such a filter is an oracle: it answers questions
  about a hidden column one request at a time.

The plan resolves once. Only the actor's own values are read per request, so a
request costs one parse and one predicate construction rather than a walk over
the rule set. Passing an already-compiled ability binds its actor, and the
request argument is then unnecessary.

## Runtime, define, AOT and `~query`

`JIT.api` has the same `query`/`parse`/`authorize`/`explain` surface on runtime
and define hosts. The definition, parser and authorized parser register
reconstructive artifacts. AOT emits an import-free parser, the V1 structural
descriptor and the same frozen explanation; an authorized boundary becomes one
generated function that parses and intersects in a single call, with the access
error class inlined. No builder, schema walker, rule set or JIT import
remains.

The boundary descriptor is consumed before query optimization. Parsed
conditions normalize to the shared query representation. The structural
`~query` protocol remains version 1 and receives no boundary, access or
physical-plan node.

## Performance and tradeoffs

`pnpm bench:api-query` compares the compiled boundary against the two shapes
this replaces — a generic config-driven REST filter parser, and schema
validation followed by generic normalization — plus the import-free AOT parser
and a handwritten specialization. Recorded on a Ryzen 7 5800H, Node 22:

| Request | JIT | JIT AOT | generic parser | zod + normalize | handwritten |
| --- | --- | --- | --- | --- | --- |
| single equality filter | 74 ns / 400 b | 78 ns / 400 b | 86 ns / 576 b | 860 ns / 2073 b | 22 ns / 241 b |
| five filters | 224 ns / 1193 b | 180 ns / 1193 b | 860 ns / 1935 b | 3124 ns / 4104 b | — |
| projection, sort, pagination | 574 ns / 1407 b | 560 ns / 1408 b | 908 ns / 1818 b | 2435 ns / 3392 b | — |
| undeclared field, first key | 8502 ns / 1715 b | 6308 ns / 816 b | 9430 ns / 1152 b | 22531 ns / 8939 b | — |
| budget exceeded, first field | 9246 ns / 3058 b | — | 7055 ns / 1848 b | — | — |
| boundary ∩ actor access | 766 ns / 2542 b | — | 1859 ns / 1805 b¹ | — | — |

¹ parse then intersect by hand, with one actor's rules written out inline.

The handwritten row is not comparable: it assumes an already valid request and
enforces no allowlist, budget or pagination bound. It is there as the ceiling.

Two results deserve to be read honestly. Rejection is dominated by building the
error — several microseconds of stack capture on every path measured, JIT and
baseline alike. And a rejected request costs the runtime host more than the
generic parser, because the specialized function stops early and then hands the
request to the reference parser for the message; the AOT parser, which throws
directly, is the fastest rejection measured.

None of these numbers is a datastore-cost estimate. They measure syntax
validation and normalization only.

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
