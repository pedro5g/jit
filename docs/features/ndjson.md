# NDJSON

## 1. Problem

Large line-delimited JSON feeds should be validated and filtered without buffering the full collection. Splitting the payload, parsing every line, building arrays for filter/map, and joining again materializes the same data several times.

## 2. Why JIT

The row schema supplies a specialized validator and serializer; the query condition AST supplies static field predicates; ProjectionTree supplies the output shape. These can lower into one line scan.

## 3. API

```ts
const parseEvents = JIT.ndjson.parse(Event);
const text = JIT.ndjson.stringify(Event)(events);

const activeIds = JIT.ndjson
  .parse(Event)
  .validate()
  .where((q) => q.eq("active", true))
  .select("id")
  .to.ndjson();
```

Parse also exposes `.to.iterator()` and `.to.visitor()`; stringify exposes a line iterator.

## 4. Semantics

Each non-blank LF or CRLF-delimited line is one JSON document validated against the row schema. The final line need not end with LF. Chunks may split UTF-8 sequences or line boundaries. Malformed JSON and schema errors identify the one-based line.

Successive `where` calls combine with AND. `select` uses the last declared static projection. `.validate()` is explicit and idempotent because NDJSON parsing never exposes an unvalidated row.

## 5. Compilation

The descriptor carries schema, semantic filters, bindings, projection and sink. The fused NDJSON sink performs: decode line → native JSON parse → specialized validation → generated condition → schema-specialized serialization. It never constructs a collection QueryProgram or invokes a query runtime.

## 6. Generated code

Generated conditions are direct reads such as `item.active === __q0`. Projection-to-NDJSON serializes selected fields from the original validated row, so it does not allocate a projected object. No `filter`, `map`, intermediate array or high-level JIT dependency remains.

## 7. Allocation model

Eager parse allocates the result array. Iterator and visitor retain only the current line/row. The fused NDJSON sink allocates the final output string and JSON.parse row objects, but no result array or projected object.

## 8. Complexity

All sinks are O(bytes + rows). Memory is O(maximum line bytes + output). The fused pipeline makes one pass regardless of the number of AND filters.

## 9. Physical strategies

The sink selects `result`, `iterator`, `visitor`, or fused `ndjson`. Projection changes the serializer schema; it is not a materialization stage for the fused sink.

## 10. AOT

Runtime and define register the same `ndjson-plan`. AOT emits scanner, validator, predicates and serializer in one import-free function. Primitive filter bindings are inlined safely; inaccessible schema callbacks are explicit skip barriers.

## 11. Runtime/AOT parity

Tests compare runtime and generated fused output and cover UTF-8 chunk cuts, final lines, validation errors, projection, multiple filters, iterator and visitor.

## 12. Benchmarks

Reproduce with `pnpm bench:ndjson`. Apple M1, Node 22.22.3, 10,000 rows (452,779 bytes):

| Scenario | Time | Heap/sample |
| --- | ---: | ---: |
| Runtime JIT validated parse | 3.21 ms | 0.99 MB |
| AOT validated parse | 3.17 ms | 0.99 MB |
| split + JSON.parse, no validation | 3.02 ms | 0.98 MB |
| Runtime JIT fused validate/filter/select/stringify | 3.53 ms | 1.98 MB |
| AOT fused validate/filter/select/stringify | 3.52 ms | 1.98 MB |
| validated materialized pipeline | 3.73 ms | 2.60 MB |
| handwritten fused, no validation | 3.47 ms | 1.83 MB |

The fair validated comparison shows the fused runtime/AOT plans about 5% faster and using about 24% less sampled heap than the materialized pipeline by eliminating its filter/project arrays. The handwritten and split baselines do less work because they do not validate, so they are reported but excluded from win/loss claims.

## 13. Tradeoffs

Native JSON.parse still materializes each row. A very short trusted feed can be faster with a plain split because setup and validation dominate. Filters currently use static schema fields and bound primitive values; parameter objects belong to CQRS rather than the transport boundary.

## 14. Best practices

Use `.to.ndjson()` when a feed is immediately filtered/projected for another boundary. Use visitor for side effects and iterator for pull-based consumers. Retain `JIT.stream.ndjson` when you need the stateful `write/end/items` interface.

## 15. Non-goals

No multiline JSON documents, pretty printing, arbitrary query operators, ordering or aggregation. Operations that need global collection state must materialize or move into CQRS.
