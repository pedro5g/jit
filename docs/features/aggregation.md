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

### Grouped

```ts
const perCustomer = JIT.cqrs
  .query(Orders)
  .groupBy("customerId")
  .aggregate({
    count: JIT.cqrs.count(),
    total: JIT.cqrs.sum("total"),
    average: JIT.cqrs.avg("total"),
  });

perCustomer(orders); // { "c1": { count, total, average }, ... }
```

Grouping keeps the record shape it already had and replaces the rows under each
key with the reductions. No group array is ever built.

## 4. Semantics

- Every field sees the same rows: the filters and `unique` run first, once.
- `count` and `sum` are `0` over an empty pass. `avg`, `min` and `max` are
  `undefined` — never `NaN`, never `Infinity`.
- Declaration order is the emission order and the result key order. The same
  declaration always produces the same source.
- Repeating a result name is rejected, as is a non-`count` field with no key,
  or a key the schema does not declare.
- A composite reduces the whole pass to one answer, so it is rejected next to
  `select`, `orderBy`, scalar aggregates, terminals and mutations.
- `groupBy` is the one collector it composes with: each group gets its own
  accumulator. `keyed` is rejected — it produces one row per key, which leaves
  nothing to reduce.
- A group only exists if a row reached it, so a grouped `avg` never divides by
  zero and a grouped `min` is never `undefined`. The ungrouped guarantees still
  apply to the whole pass being empty.

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

### Grouped

With no average, the accumulator is already the result and is written straight
into the record:

```js
const out = Object.create(null);
for (let i = 0; i < len; i++) {
  const item = value[i];
  const collectKey = item.customerId;
  let group = out[collectKey];
  if (group === undefined) {
    group = { "count": 0, "total": 0, "lowest": undefined };
    out[collectKey] = group;
  }
  group.count = (group.count + 1);
  group.total = (group.total + item.total);
  if ((group.lowest === undefined) || (item.total < group.lowest)) {
    group.lowest = item.total;
  }
}
return out;
```

An average needs a per-group row count, so accumulation goes through a `Map` —
whose iteration yields key and accumulator together — and one pass **over the
groups**, not the rows, resolves the divisions and drops the internal counter:

```js
const out = Object.create(null);
for (const entry of acc) {
  const key = entry[0];
  const group = entry[1];
  out[key] = { "count": group.count, "average": (group.average / group.__n) };
}
return out;
```

There is no `Map<key, Order[]>` and no second pass over rows in either shape.

## 7. Allocation model

| Allocation                  | Count |
| --------------------------- | ----- |
| result object               | 1     |
| accumulators                | 0 — locals |
| intermediate arrays         | 0     |
| per-row closures or objects | 0     |

Measured at 427 bytes per call over 10 000 rows against 251.4 kB for the
idiomatic `filter` + `reduce` chain, whose intermediate array is the difference.

Grouped, over 10 000 rows in 250 groups:

| Allocation                | Hash aggregate      | `groupBy` then reduce |
| ------------------------- | ------------------- | --------------------- |
| accumulator per group     | 1                   | 1 (the result)        |
| **array per group**       | **0**               | **1**                 |
| rows copied into groups   | 0                   | 10 000                |
| heap per call             | 36.8 kB             | 298.7 kB              |

An average adds one `Map` and one result object per group — 83.5 kB — which is
still a third of what materializing the groups costs.

## 8. Complexity

```text
k reductions, separately:   k passes, O(k·n)
composite:                  1 pass,  O(n)

grouped, materialized:      O(n) to group + O(n) to reduce, plus g arrays
hash aggregate:             O(n), plus O(g) only when an average is asked for
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
| idiomatic `filter` + `reduce`   |       325.08 µs |  251.4 kB |              — |
| separate JIT scalar aggregates  |        69.40 µs |     428 B |       24.50 µs |
| **`aggregate({...})`**          |    **25.22 µs** | **427 B** |   **13.65 µs** |
| handwritten one-pass loop       |        25.17 µs |     291 B |       13.78 µs |

Against the scalar aggregates it replaces, the composite is 2.8x faster at five
reductions and 1.8x at two — close to the pass count it removes. Against the
idiomatic chain it is 12.9x faster and allocates ~590x less, because that chain
materializes the filtered array before reducing it four more times.

It is level with a handwritten one-pass loop, which is the ceiling: the
composite emits that loop.

### Grouped, 10 000 rows in 250 groups

| Approach                     |      Time | Heap/call |
| ---------------------------- | --------: | --------: |
| `groupBy` then reduce        | 216.07 µs |  298.7 kB |
| **grouped `aggregate`**      |  **99.27 µs** | **36.8 kB** |
| handwritten accumulator map  | 102.63 µs |   36.7 kB |

2.2x faster and 8.1x less heap than grouping into arrays first, and level with
the accumulator map written by hand. With an average the same query is
148.51 µs and 83.5 kB against 201.63 µs and 301.6 kB — the `Map` and the
finalization pass are what that costs.

## 12. Tradeoffs

- Two reductions save less than five. One reduction should stay a scalar
  aggregate — there is no pass to remove.
- A grouped average is measurably more expensive than the other reductions: it
  routes accumulation through a `Map` and adds a pass over the groups. Ask for
  `count` and `sum` and divide yourself if that pass matters.
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

- No grouping by more than one key, and no `keyed` collector — one row per key
  leaves nothing to reduce.
- No user-defined reductions. A callback per row is exactly the cost this
  operation exists to remove.
- No distinct-within-aggregate (`countDistinct`). `unique` before the aggregate
  covers the whole pass, not one field.
