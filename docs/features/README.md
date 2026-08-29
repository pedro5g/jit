# JIT Feature Guide

This directory documents the user-facing features that matter for day-to-day
work and for production performance. Each page explains:

- the API shape;
- when to use it;
- why the generated code is faster;
- why it allocates less memory;
- what to watch for when shipping to a browser or server bundle.

## Guides

- [AOT generation and tree sharing](./aot-tree-sharing.md)
- [Runtime validation](./runtime-validation.md)
- [Composable execution pipelines](./composable-execution.md)
- [CLI and config](./cli-and-config.md)
- [Cache, hash, and index strategies](./cache-hash-index.md)
- [Schema operators](./schema-operators.md)
- [Temporal, ISO, codecs, and special schemas](./temporal-iso-codec-special-schemas.md)
- [Queries, mappers, and high-volume flows](./query-mapper-flows.md)
- [Canonical CQRS queries](./cqrs.md)
- [API query boundaries](./api-query-boundaries.md)
- [Compiled state](./state.md)
- [Mutation planner](./mutation-planner.md)
- [State collections](./state-collections.md)
- [Mutation changes](./mutation-changes.md)
- [Derived state](./derived-state.md)
- [Sort and ordering plans](./sort.md)
- [Indexing](./indexing.md)
- [Physical query planning](./physical-query-planning.md)
- [Aggregation](./aggregation.md)
- [Joins](./joins.md)
- [Distinct query rows](./distinct.md)
- [Lookup](./lookup.md)
- [Reconcile](./reconcile.md)
- [Projection](./projection.md)
- [Change masks](./changed.md)
- [Patch](./patch.md)
- [Cache keys](./cache-key.md)
- [Canonical](./canonical.md)
- [Access control](./access-control.md)
- [Rules](./rules.md)
- [Match](./match.md)
- [Schema migrations](./migration.md)
- [CSV](./csv.md)
- [NDJSON](./ndjson.md)
- [Lazy queries, iterators, and visitors](./lazy-execution.md)
- [Serialization and binary codec](./serialization-codec.md)
- [Binary rowsets](./binary-rowsets.md)
- [Benchmarks, memory, and load testing](./benchmarks-memory-load.md)
- [Executable runtime and AOT examples](./examples.md)
- [MCP server for coding agents](./mcp-server.md)

## Find A Feature By Goal

| Goal                              | Start here              | Main decision                               |
| --------------------------------- | ----------------------- | ------------------------------------------- |
| Validate one request/config value | Runtime validation      | `is` vs `parse` vs `safeParse`              |
| Compose a request/response flow   | Composable execution    | stages, boundaries, and AOT-safe bindings   |
| Define constraints and transforms | Schema operators        | built-in operator vs callback refinement    |
| Model date/time boundaries        | Temporal, ISO, codecs   | ISO string vs Date vs Temporal              |
| Filter/project application arrays | Queries and mappers     | eager result vs iterator/visitor            |
| Order a collection by fields      | Sort and ordering       | callable copy vs `inPlace` vs `compare`     |
| Look rows up by a key             | Indexing                | fresh build vs `cached` vs a scan           |
| Find one row in a collection      | Physical query planning | declare facts; the planner picks the path   |
| Reduce a collection to numbers    | Aggregation             | one `aggregate({...})` vs separate passes   |
| Relate two typed collections      | Joins                   | semantic join; planner selects hash/index   |
| Deduplicate query rows            | Distinct                | projected key vs complete structural value  |
| Process unbounded/cursor input    | Lazy execution          | sync iterator vs async iterator             |
| Scan million-row flat batches     | Binary rowsets          | packed/aligned/columnar and memory strategy |
| Send JSON or binary data          | Serialization and codec | full string, chunks, or versioned bytes     |
| Publish or consume a contract     | JSON Schema bridge      | `to` a document vs `from` a document        |
| Reuse expensive lookups           | Cache/hash/index        | build cost vs reuse count                   |
| Model entity collections          | Cache/hash/index        | identity vs index vs keyed output           |
| Ship strict-CSP/browser code      | AOT/tree sharing        | artifact object vs standalone artifact      |
| Configure generation/CI           | CLI and config          | discovery, output package and diagnostics   |
| Reproduce performance claims      | Benchmarks/load         | matching fixture, heap and GC               |
| Compare JIT and generated code    | Executable examples     | runtime lifecycle vs import-free AOT        |
| Give an agent safe JIT context    | MCP server              | inspect/preview first, explicit generation  |

The public website mirrors these guides with smaller task-oriented pages and a
complete operator reference under `apps/site/content/docs`.

The removed `validator`, `mapper`, `model`, and `serializer` selection facades
are not part of the current surface. Use the composable capability artifacts
documented above.

## Recommended Path

For application code, prefer this order:

1. Define schemas with `JIT.object`, `JIT.string`, `JIT.number`, and the
   typed operator chain.
2. Use direct artifacts such as `JIT.validate.is(schema)`, `JIT.validate.parse(schema)`, and
   `JIT.json.stringify(schema)`. Compose boundary work with
   `JIT.json.parse(schema).validate().filter(...).to.json()`.
3. For runtime-only apps, import from `@jit-compiler/jit/runtime`.
4. For generated production bundles, export compiled artifacts from
   `*.jit.ts` files and run `jit generate`.
5. In front-end code, import only the generated function or artifact object you
   actually call. That is what lets the bundler keep the final bundle tiny.

## Performance Model

JIT is fast because expensive work moves from hot calls to compile time:

- schema traversal happens once;
- generated code reads known properties directly;
- loops are classic indexed loops;
- checks are ordered cheapest-first;
- query and mapper pipelines are fused;
- binary rowsets scan compact `ArrayBuffer` rows by fixed offsets, selecting
  packed `DataView`, aligned typed-array, or contiguous columnar access from
  the compiled layout;
- optional cache helpers are emitted only when a strategy needs them;
- AOT output is plain JS with zero imports from the JIT engine.

The memory model follows the same idea: avoid intermediate objects and arrays,
return the original reference when no transformation is needed, and keep
helper state in `WeakMap` caches so entries disappear when user data is no
longer referenced.
