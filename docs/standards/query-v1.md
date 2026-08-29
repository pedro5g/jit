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
mutation, scalar aggregation, composite aggregation, joins and terminals. Callback-backed
scan updates remain named bindings rather than embedded functions. The
compatibility summary fields `filter`, `projection`, `order`, and `limit`
describe the effective common read-query subset for simple adapters.

`distinct` is represented as `{ kind: "distinct", fields: string[] }`. An empty
field list means full-row structural distinct. Physical scalar-table, trie,
hash or adjacent strategies remain private compiler details.

### Terminals

A terminal states that the request wants one answer rather than a collection:

```json
{ "kind": "terminal", "operation": "first" }
```

`operation` is `first`, `findIndex`, `some` or `every`. An adapter lowers
`first` to its own single-row form (`LIMIT 1`) and `some` to an existence check
(`EXISTS`), rather than inferring either from a limit of one. `findIndex` asks
for a position in the source order and an adapter that cannot express that must
reject the request instead of approximating it.

### Composite aggregation

A composite states every reduction the request needs, so an adapter issues one
query instead of one per number:

```json
{
  "kind": "aggregate:composite",
  "fields": [
    { "name": "count", "operation": "count" },
    { "name": "revenue", "operation": "sum", "key": "total" }
  ]
}
```

`name` is the caller's result key and `operation` is one of the five scalar
operators. Field order is the declared order and is stable. A composite that
follows a `groupBy` step reduces within each group.

### Join

A join step describes the relation, not its local access path:

```json
{
  "kind": "join",
  "join": "inner",
  "source": { "kind": "object", "fields": ["id", "name"] },
  "leftKey": "customerId",
  "rightKey": "id"
}
```

`join` is `inner`, `left`, `semi`, or `anti`. The right source shape is
structural. `HashJoin`, `IndexedJoin`, `MergeJoin`, cache descriptors and bucket
layout are private physical decisions and never cross this boundary. An adapter that
cannot preserve multiplicity, left ordering or the requested missing-row
semantics must reject the step.

### Evolving V1

New steps are added to version 1 rather than starting a version 2. The protocol
has no published external compatibility boundary yet: there are no third-party
adapters pinned to a frozen step list, so a v2 would cost every reader a
migration and buy nothing. An adapter is expected to reject a step it does not
recognize, which is what makes adding one safe.

Version 2 becomes the right answer only when V1 has been published and used
externally, adapters exist that would break, and a change cannot be expressed
additively.

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

`JIT.api.query(...)` exposes the same versioned entry point, but its
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
