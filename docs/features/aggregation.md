# Aggregation

`aggregate({...})` answers several reductions from one pass. Each field owns an
accumulator local, so asking for five numbers reads the collection once and
allocates one object.

## 1. Problem

Scalar aggregates each run their own pass. Asking for five means five passes:

```ts
const matching = orders.filter((order) => order.total > 10);

const summary = {
  count: matching.length,
  revenue: matching.reduce((total, order) => total + order.total, 0),
  average: matching.reduce((total, order) => total + order.total, 0) / matching.length,
  lowest: matching.reduce((low, order) => Math.min(low, order.total), Infinity),
  highest: matching.reduce((high, order) => Math.max(high, order.total), -Infinity),
};
```

That is one intermediate array plus four more walks over it, a callback per row
per reduction, and an `average` that divides by zero on an empty result while
`lowest` quietly returns `Infinity`.

## 2. Why JIT

The reductions are known before the loop is emitted, so the loop can carry all
of them. The schema fixes which fields are numeric and rejects a key that does
not exist, and the empty case is resolved once after the pass rather than
guarded inside it.

## 3. API

```ts
const summary = JIT.cqrs
  .query(Orders)
  .where((query) => query.gt("total", 10))
  .aggregate({
    count: JIT.cqrs.count(),
    revenue: JIT.cqrs.sum("total"),
    average: JIT.cqrs.avg("total"),
    lowest: JIT.cqrs.min("total"),
    highest: JIT.cqrs.max("total"),
  });

summary(orders); // { count, revenue, average, lowest, highest }
```

The reduction factories are `JIT.cqrs.count()`, `.sum(key)`, `.avg(key)`,
`.min(key)` and `.max(key)` — the same five operators the scalar aggregates
already expose, so there is no second vocabulary to learn.

Result names are yours. The result type follows the spec: `count` and `sum`
are `number`, and `avg`, `min` and `max` are `number | undefined`, because an
empty pass has no answer for them.

## 4. Semantics

- Every field sees the same rows: the filters and `unique` run first, once.
- `count` and `sum` are `0` over an empty pass. `avg`, `min` and `max` are
  `undefined` — never `NaN`, never `Infinity`.
- Declaration order is the emission order and the result key order. The same
  declaration always produces the same source.
- Repeating a result name is rejected, as is a non-`count` field with no key,
  or a key the schema does not declare.
- A composite reduces the whole pass to one answer, so it is rejected next to
  `select`, `orderBy`, scalar aggregates, terminals and mutations. Grouped
  aggregation is not supported yet and says so explicitly.

## 5. Compilation

The composite becomes one `aggregate:composite` node on the existing
`QueryProgram`; there is no second aggregation engine. Lowering allocates one
accumulator local per field, plus a counter for each `avg`.

## 6. Generated code

```js
function query(value) {
  const len = value.length;
  let a0 = 0;
  let a1 = 0;
  let a2 = 0;
  let n2 = 0;
  let a3;
  let a4;
  for (let i = 0; i < len; i++) {
    const item = value[i];
    if ((item.total > __q0)) {
      a0 = (a0 + 1);
      a1 = (a1 + item.total);
      a2 = (a2 + item.total);
      n2 = (n2 + 1);
      if ((a3 === undefined) || (item.total < a3)) {
        a3 = item.total;
      }
      if ((a4 === undefined) || (item.total > a4)) {
        a4 = item.total;
      }
    }
  }
  if (n2 === 0) {
    a2 = undefined;
  } else {
    a2 = (a2 / n2);
  }
  return { "count": a0, "revenue": a1, "average": a2, "lowest": a3, "highest": a4 };
}
```

One loop. No callbacks, no intermediate array, no second reduce pass, and the
division that would have been guarded per row happens once.

## 7. Allocation model

| Allocation                  | Count |
| --------------------------- | ----- |
| result object               | 1     |
| accumulators                | 0 — locals |
| intermediate arrays         | 0     |
| per-row closures or objects | 0     |

Measured at 436 bytes per call over 10 000 rows against 251.4 kB for the
idiomatic `filter` + `reduce` chain, whose intermediate array is the difference.

## 8. Complexity

```text
k reductions, separately:   k passes, O(k·n)
composite:                  1 pass,  O(n)
```

The per-row work still grows with `k`; what disappears is re-reading the
collection and re-testing the filter for each reduction.

## 9. AOT

`aggregate` exists with the same signature on `@jit-compiler/jit/define`, and
the generated module carries the loop and its accumulators with no JIT import.
The generated TypeScript names each field's type, so a generated `summary` is
`{ readonly count: number; readonly average: number | undefined; ... }` rather
than an opaque record.

## 10. Runtime/AOT parity

- one API on both hosts, covered by the parity matrix in
  `src/__tests__/entrypoints.test.ts`;
- `~query` V1 carries an `aggregate:composite` step, so an adapter can push all
  five reductions into one external query instead of five;
- a tree-shaking fixture asserts one loop, no `reduce`, and no result array.

## 11. Benchmarks

```text
Command      pnpm bench:cqrs-aggregate
Source       bench/cqrs-aggregate/index.ts
Environment  Node 22.22.3, Apple M1, darwin-arm64
Dataset      10 000 rows, filter keeps ~90%
Captured     2026-08-26
```

| Approach                        | Five reductions | Heap/call | Two reductions |
| ------------------------------- | --------------: | --------: | -------------: |
| idiomatic `filter` + `reduce`   |       325.55 µs |  251.4 kB |              — |
| separate JIT scalar aggregates  |        70.93 µs |     414 B |       24.52 µs |
| **`aggregate({...})`**          |    **25.24 µs** | **436 B** |   **13.56 µs** |
| handwritten one-pass loop       |        25.75 µs |     314 B |       14.04 µs |

Against the scalar aggregates it replaces, the composite is 2.8x faster at five
reductions and 1.8x at two — close to the pass count it removes. Against the
idiomatic chain it is 12.9x faster and allocates ~590x less, because that chain
materializes the filtered array before reducing it four more times.

It is level with a handwritten one-pass loop, which is the ceiling: the
composite emits that loop.

## 12. Tradeoffs

- Two reductions save less than five. One reduction should stay a scalar
  aggregate — there is no pass to remove.
- Reduction keys are strings on the factory (`JIT.cqrs.sum("total")`) and are
  checked when the query compiles, not where the factory is called. An unknown
  key is a clear compile-time error rather than an editor error.
- The result object is allocated per call. For a reduction called in a hot loop
  over many collections, that is one object each time.

## 13. Best practices

- Ask for every number you need in one `aggregate` rather than chaining
  separate queries over the same rows.
- Put the filter in `where`; it runs once for all reductions.
- Read `count` from the composite instead of a second `count()` query.

## 14. Non-goals

- No grouped aggregation yet. `groupBy(...).aggregate({...})` is rejected
  explicitly rather than silently materializing a group array per key; it is
  the next milestone.
- No user-defined reductions. A callback per row is exactly the cost this
  operation exists to remove.
- No distinct-within-aggregate (`countDistinct`). `unique` before the aggregate
  covers the whole pass, not one field.
