# CSV

## 1. Problem

CSV is a stateful text format: delimiters and newlines inside quoted fields, escaped quotes, CRLF boundaries, and UTF-8 sequences can all cross chunks. `split(",")` is not a parser, while a generic parser still needs a second schema walk to convert and validate every row.

## 2. Why JIT

The row schema fixes column names, scalar types, nullability, defaults, transforms and Runtime Type materialization. JIT emits static column reads and conversions, then calls the specialized validator once per completed record.

## 3. API

```ts
const parseUsers = JIT.csv.parse(User);
const users = parseUsers(csvText);

JIT.csv.stringify(User)(users);

JIT.csv.parse(User, {
  delimiter: ";",
  columns: { id: "identifier", name: "full name" },
});
```

`header` defaults to `true`. A one-character delimiter and per-field header aliases are explicit options.

## 4. Semantics

RFC 4180 quoting is supported: doubled quotes, embedded delimiters, embedded CR/LF, CRLF and LF records. The schema must be an object whose fields lower to string, number/int, boolean, bigint, Date, literal, enum or null after transparent wrappers. Empty optional/default fields become `undefined`; empty nullable fields become `null`; the validator resolves defaults and transforms.

Missing or duplicate required headers, malformed quotes, invalid scalar values and schema violations throw. Nested values are rejected at declaration instead of being silently JSON-encoded.

## 5. Compilation

The descriptor resolves fields and column aliases once. The emitted scanner maintains quote, CRLF and decoder state across chunks. Header positions are found once with a generated switch. Each row becomes one static object literal followed by the compiled validator.

## 6. Generated code

The hot path contains one character loop, direct `record[pN]` reads and a static row literal. It contains no `split`, `Object.keys`, reflection or schema walker. Stringify emits fields in schema order and takes a fast path for cells that need no escaping.

## 7. Allocation model

The eager parser materializes its result array and one field array per physical record. `.to.iterator()` yields validated rows as soon as records finish; `.to.visitor()` avoids the result array and calls the consumer directly. Stringify returns one rope-like string; its iterator yields header/record chunks.

## 8. Complexity

Parse and stringify are O(bytes + fields × rows). Header resolution is O(header columns) once. Memory is O(maximum record bytes + materialized output); iterator and visitor do not retain previous records.

## 9. Physical strategies

`result`, `iterator`, and `visitor` share the same incremental FSM. Headerless input bakes ordinal positions directly; header input emits one switch to resolve aliases.

## 10. AOT

Runtime and define register a `csv-plan`. AOT emits the scanner, static row parser, selected sink and specialized validator with no JIT import. Non-reconstructible schema callbacks produce the same explicit validation-binding skip used elsewhere.

## 11. Runtime/AOT parity

Parity tests cover quoted commas/quotes/newlines, CRLF, fragmented UTF-8, null/default conversion, aliases, headerless rows, iterator, visitor and stringify.

## 12. Benchmarks

Reproduce with `pnpm bench:csv`. Apple M1, Node 22.22.3, 10,000 scalar rows (212,794 bytes, decimal MB):

| Operation | Runtime JIT | Runtime throughput | AOT | AOT throughput | Known-clean handwritten ceiling |
| --- | ---: | ---: | ---: | ---: | ---: |
| parse | 2.43 ms | 87.7 MB/s | 2.57 ms | 82.9 MB/s | 0.728 ms |
| stringify | 1.28 ms | 166.4 MB/s | 1.26 ms | 169.0 MB/s | 0.453 ms |

The ceiling deliberately assumes no quoted fields and is not RFC 4180 compatible; it documents the price of correctness rather than a speedup claim. Runtime and AOT stay in the same performance band. Sampled heap per parse was 5.64 MiB runtime and 5.83 MiB AOT; stringify was 1.75 MiB in both. CSV belongs in JIT because schema-directed conversion/validation removes a second pass and the incremental sinks bound retention, not because a complete parser beats code that assumes clean input.

## 13. Tradeoffs

Every parsed field is initially text, and RFC quoting requires a mutable field buffer. Iterator/visitor reduce retained output but cannot make string assembly allocation-free. BigInt and Date conversion can throw before the validator formats an issue.

## 14. Best practices

Use visitor for ingestion side effects and iterator for pull-based pipelines. Use explicit aliases for external headers and keep nested structures out of CSV rather than inventing implicit JSON columns.

## 15. Non-goals

No dialect guessing, multi-character delimiter, spreadsheet formula policy, nested JSON cells, or random access. CSV is transport, not a query engine.
