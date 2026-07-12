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
- [CLI and config](./cli-and-config.md)
- [Cache, hash, and index strategies](./cache-hash-index.md)
- [Schema operators](./schema-operators.md)
- [Temporal, ISO, codecs, and special schemas](./temporal-iso-codec-special-schemas.md)
- [Queries, mappers, and high-volume flows](./query-mapper-flows.md)
- [Lazy queries, iterators, and visitors](./lazy-execution.md)
- [Serialization and binary codec](./serialization-codec.md)
- [Binary rowsets](./binary-rowsets.md)
- [Benchmarks, memory, and load testing](./benchmarks-memory-load.md)

## Find A Feature By Goal

| Goal                              | Start here              | Main decision                               |
| --------------------------------- | ----------------------- | ------------------------------------------- |
| Validate one request/config value | Runtime validation      | `is` vs `parse` vs `safeParse`              |
| Define constraints and transforms | Schema operators        | built-in operator vs callback refinement    |
| Model date/time boundaries        | Temporal, ISO, codecs   | ISO string vs Date vs Temporal              |
| Filter/project application arrays | Queries and mappers     | eager result vs iterator/visitor            |
| Process unbounded/cursor input    | Lazy execution          | sync iterator vs async iterator             |
| Scan million-row flat batches     | Binary rowsets          | packed/aligned/columnar and memory strategy |
| Send JSON or binary data          | Serialization and codec | full string, chunks, or versioned bytes     |
| Reuse expensive lookups           | Cache/hash/index        | build cost vs reuse count                   |
| Ship strict-CSP/browser code      | AOT/tree sharing        | grouped object vs standalone export         |
| Configure generation/CI           | CLI and config          | discovery, output package and diagnostics   |
| Reproduce performance claims      | Benchmarks/load         | matching fixture, heap and GC               |

The public website mirrors these guides with smaller task-oriented pages and a
complete operator reference under `apps/site/content/docs`.

## Recommended Path

For application code, prefer this order:

1. Define schemas with `JIT.object`, `JIT.string`, `JIT.number`, and the
   typed operator chain.
2. Compile only the operations you need with `JIT.validate(...).is().compile()`,
   `JIT.json(...).stringify().compile()`, `JIT.query(...).compile()`, etc.
3. For runtime-only apps, import from `@pedro5g/jit/runtime`.
4. For generated production bundles, export compiled artifacts from
   `*.jit.ts` files and run `jit generate`.
5. In front-end code, import only the generated function or grouped object you
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
