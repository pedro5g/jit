# Sort And Ordering Plans

`JIT.sort` compiles a comparator from the schema instead of building one from a
list of criteria at call time. The same `OrderingDescriptor` that backs it also
backs every other ordering in the library, so a `orderBy` in a query, a
`.ordered()` collection fact and a standalone sort all lower through one
emitter.

## 1. Problem

A comparator written by hand is cheap to write once and expensive to keep
correct. Multi-field ordering drifts into one of three shapes:

```ts
// Re-reads the key through a string on every comparison.
rows.sort((a, b) => (a[key] < b[key] ? -1 : 1));

// Allocates a comparator per call and walks a criteria array per comparison.
rows.sort(makeComparator([["lastName", "asc"], ["createdAt", "desc"]]));

// Correct, but rewritten by hand for every new ordering.
rows.sort((a, b) => a.lastName.localeCompare(b.lastName) || +b.createdAt - +a.createdAt);
```

The recurring defects are not performance defects. They are `Date` objects
compared with `<` (which stringifies), absent values that make the comparator
non-antisymmetric, and later criteria that are never reached because an earlier
one returned a value it should not have.

## 2. Why JIT

The schema already states what the library needs to specialize:

- which keys exist, so an unknown key is a compile error rather than `undefined`;
- whether a key is a `Date`, so `getTime()` is emitted once instead of relying
  on relational coercion;
- whether a key is float64, so subtraction can replace a comparison pair;
- whether a key is optional or nullable, so the absent-value branch is emitted
  only where a value can actually be absent.

None of that is discoverable in a hand-written comparator without reading the
type and trusting the author to keep it in sync.

## 3. API

```ts
const sortUsers = JIT.sort(User).by("lastName", "asc").thenBy("createdAt", "desc");

const ordered = sortUsers(users); // new array
sortUsers.inPlace(users); // sorts and returns the same array
sortUsers.compare(left, right); // the raw comparator
```

`by` starts an ordering and `thenBy` appends a criterion. Direction defaults to
`"asc"`. Keys are `keyof` the row type, so an unknown key does not compile and
does not construct.

The schema may be the row object or an array of it — `JIT.sort(User)` and
`JIT.sort(JIT.array(User))` produce the same plan.

## 4. Semantics

- The callable is non-mutating: it returns a new array. Mutation is available
  only through the explicit `inPlace`.
- Sorting is stable, because it delegates to `Array.prototype.sort`.
- Criteria are evaluated in declaration order; the first one that distinguishes
  the two rows decides, and the rest are not evaluated.
- Absent values (`null` and `undefined`) order **before** present values
  ascending and **after** them descending. `null` and `undefined` are treated as
  equally absent and never ordered relative to each other — two absent values
  fall through to the next criterion.
- A key must resolve to a statically orderable scalar: string, number, int,
  bigint, boolean, literal, enum, or `Date`, optionally wrapped in
  optional/nullable/branded/runtime-type wrappers. An object or array key is
  rejected at construction.
- Repeating a key in one ordering is rejected at construction.

### Rejected at construction

```ts
JIT.sort(User).by("missing"); // unknown key
JIT.sort(User).by("id").thenBy("id"); // repeated key
JIT.sort(Nested).by("value"); // not a statically orderable scalar
```

## 5. Compilation

```text
schema + criteria
      ↓  resolveOrderingDescriptor
OrderingDescriptor        key, direction, valueKind, nullish
      ↓  emitOrderingComparatorBody
comparator source
      ↓
JIT.sort · query orderBy · compileSortBy · lazy orderBy
```

`OrderingDescriptor` is the single semantic ordering type. `valueKind` is the
resolved physical treatment of the key:

| `valueKind` | Source types                                   | Emission                       |
| ----------- | ---------------------------------------------- | ------------------------------ |
| `numeric`   | number, int                                    | float64 subtraction where safe |
| `date`      | Date                                           | `getTime()` hoisted per row    |
| `direct`    | string, bigint, boolean, literal, enum         | `!==` then `<`                 |

Wrappers are resolved before classification, so a branded `number` and a
`RuntimeType` over a `Date` classify as `numeric` and `date` respectively.

The descriptor lives on the artifact record, not on the compiled function. A
compiled plan carries no descriptor, because an AOT plan must not embed one.

## 6. Generated code

`JIT.sort(User).by("lastName").thenBy("createdAt", "desc")`:

```js
const compare = (left, right) => {
  const leftValue0 = left.lastName;
  const rightValue0 = right.lastName;
  if (leftValue0 !== rightValue0) {
    return leftValue0 < rightValue0 ? -1 : 1;
  }
  const leftRaw1 = left.createdAt;
  const rightRaw1 = right.createdAt;
  const leftValue1 = leftRaw1.getTime();
  const rightValue1 = rightRaw1.getTime();
  if (leftValue1 !== rightValue1) {
    return leftValue1 < rightValue1 ? 1 : -1;
  }
  return 0;
};
```

A single numeric key lowers to subtraction with no trailing branch at all:

```js
const compare = (left, right) => {
  const leftValue = left.id;
  const rightValue = right.id;
  return leftValue - rightValue;
};
```

An optional key emits the absent branch only for that criterion:

```js
if (leftValue == null || rightValue == null) {
  if (leftValue != null) return 1;
  if (rightValue != null) return -1;
} else {
  return leftValue - rightValue;
}
return 0;
```

What is absent from all three: no `Object.keys`, no criteria array, no per-row
closure, no dynamic key string, no comparator list walked per comparison.

### Why subtraction is conditional

Float64 subtraction is the cheapest correct comparison, but its result cannot
be told apart from "equal" when it is `NaN` — and `Infinity - Infinity` is
`NaN`. A criterion that returns `NaN` is treated by `Array.prototype.sort` as
`+0`, which silently skips every later criterion. Subtraction is therefore
emitted only for the **last** criterion, where nothing depends on falling
through. Earlier numeric criteria keep the `!==` form.

## 7. Allocation model

Per call:

| Allocation           | `sortUsers(rows)` | `sortUsers.inPlace(rows)` |
| -------------------- | ----------------- | ------------------------- |
| output array         | 1 (`slice`)       | 0                         |
| comparator           | 0 (compiled once) | 0                         |
| per-row temporaries  | 0                 | 0                         |
| boxed key values     | 0                 | 0                         |

The comparator and both entry points are created once, when the plan is
compiled. Nothing is allocated per comparison: `getTime()` results are locals,
not objects.

## 8. Complexity

Sorting is `O(n log n)` — the plan changes the constant factor, not the class.
The one complexity claim that does hold is per-comparison work: a criteria-array
comparator is `O(k)` interpretation per comparison for `k` criteria, while the
compiled comparator is straight-line code with an early return per criterion.

## 9. Physical strategies

The current release emits one strategy: a specialized comparator handed to
`Array.prototype.sort`. `OrderingDescriptor` exists so that the ordering-aware
strategies planned around it — binary search and range scan over `.ordered()`
collections, merge join, top-K, cursor ordering — read the same semantic
ordering rather than re-deriving one. Those strategies are not implemented yet
and this document will state their selection rules when they are.

## 10. AOT

`JIT.sort` exists with the same signature on `@jit-compiler/jit/define`. The
definition-host plan is a non-executable stub that registers the same
descriptor; calling it, its `compare`, or its `inPlace` throws
`JIT_AOT_001_ARTIFACT_EXECUTED`.

Generated output is a self-contained IIFE with no import from the JIT package:

```js
// Generated by jit — do not edit.
const sortUsers = /*#__PURE__*/ (() => {
  const compare = (left, right) => {
    const leftValue0 = left.lastName;
    const rightValue0 = right.lastName;
    if (leftValue0 !== rightValue0) {
      return leftValue0 < rightValue0 ? -1 : 1;
    }
    const leftRaw1 = left.createdAt;
    const rightRaw1 = right.createdAt;
    const leftValue1 = leftRaw1.getTime();
    const rightValue1 = rightRaw1.getTime();
    if (leftValue1 !== rightValue1) {
      return leftValue1 < rightValue1 ? 1 : -1;
    }
    return 0;
  };
  const sort = (value) => {
    const out = value.slice();
    out.sort(compare);
    return out;
  };
  Object.defineProperties(sort, {
    compare: { value: compare },
    inPlace: { value: (value) => value.sort(compare) },
  });
  return sort;
})();
export { sortUsers };
```

The `ts` output format carries the full public signature, including `compare`
and `inPlace`, so the generated module types identically to the runtime plan.

## 11. Runtime/AOT parity

- one API: `JIT.sort` on runtime and define, no `JIT.aot.sort` and no
  `JIT.defineSort`;
- the parity case in `src/__tests__/entrypoints.test.ts` runs the runtime plan
  and the generated plan over the same input and compares results;
- generated source is covered by a deterministic snapshot;
- a tree-shaking fixture bundles a sort plan and asserts that no unrelated
  compiler, no neighbouring artifact, and no generic comparator survives.

## 12. Benchmarks

```text
Command      pnpm bench:sort
Source       bench/sort/index.ts
Environment  Node 22.22.3, Apple M1, darwin-arm64
Dataset      1000 rows, sorted per call from a fresh slice
Captured     2026-08-26
```

Times are µs/iteration for a full 1000-row sort; lower is better.

| Scenario                | Idiomatic | Handwritten | JIT runtime | JIT AOT | vs idiomatic (rt/AOT) |
| ----------------------- | --------: | ----------: | ----------: | ------: | --------------------: |
| number / random         |     98.88 |       98.34 |       96.05 |   97.40 |         1.03x / 1.02x |
| number / sorted         |     11.31 |       11.16 |       11.89 |   11.80 |         0.95x / 0.96x |
| number / reverse        |     11.87 |       12.09 |       12.47 |   12.35 |         0.95x / 0.96x |
| number / mostly sorted  |     11.20 |       11.14 |       11.61 |   11.62 |         0.96x / 0.96x |
| Date / random           |    130.89 |      132.11 |      122.00 |  128.63 |         1.07x / 1.02x |
| short string / random   |    130.12 |      129.33 |      118.12 |  118.31 |         1.10x / 1.10x |
| long string / random    |    244.71 |      241.25 |      246.88 |  239.94 |         0.99x / 1.02x |
| branded scalar / random |     78.70 |       78.66 |       76.60 |   78.27 |         1.03x / 1.01x |
| multi-field / random    |    127.03 |      128.41 |      123.96 |  120.29 |         1.02x / 1.06x |

Heap per iteration is the output array and nothing else — 25.33 kb for a
1000-row numeric sort against 25.13 kb idiomatic, i.e. the `slice` and no
comparator-side allocation. Run-to-run variance on this harness is roughly
±5%, which is wider than several of the differences above.

### Reading this table honestly

- **Date and short string are real wins** (≈1.07–1.10x), and they are the
  cases where the idiomatic comparator does avoidable work: relational
  coercion of `Date`, and a second `>` comparison for strings.
- **Numeric keys are at parity.** A compiled comparator cannot beat
  `(a, b) => a.id - b.id`, because that *is* the specialization. Once the
  `numeric` kind emits subtraction, JIT lands within noise of it. The
  pre-sorted rows (0.95–0.96x) are ~0.5 µs on an 11 µs operation, inside the
  harness's variance.
- **Long string is dominated by string comparison itself**, so no comparator
  shape moves it.
- **Multi-field gains are modest** at three criteria and grow with criteria
  count, because the compiled form is what removes per-comparison dispatch.

No claim is made here that `JIT.sort` is broadly faster than a comparator
written by hand for one specific ordering. It is not, and the handwritten
column exists to say so. What it provides is that comparator, derived from the
schema, correct for absent values and `Date`, shared with query ordering, and
emitted into AOT with no runtime attached.

## 13. Tradeoffs

- Compilation costs a `new Function` call on first use. Sort a handful of small
  arrays once and an inline arrow is cheaper end to end.
- Single-key numeric sorts gain nothing measurable. Reach for `JIT.sort` there
  for the schema-checked key and AOT parity, not for speed.
- Ordering is by comparison, not by locale. `localeCompare` is not emitted; a
  locale-aware ordering is out of scope, and code needing it should keep its own
  comparator.
- The absent-value rule is fixed. A "nulls last ascending" ordering is not
  expressible today.

## 14. Best practices

- Compile the plan once at module scope and call it in the hot path.
- Put the most selective criterion first, so later criteria are rarely reached.
- Prefer `inPlace` when the input array is already private to the caller; the
  `slice` is the only per-call allocation and it is the one worth removing.
- Reuse `compare` where an API takes a comparator, rather than wrapping the
  callable.
- Declare `.ordered(key, direction)` on the collection when the data is already
  ordered; it is the fact the ordering-aware strategies will read.

## 15. Non-goals

- Not a sorting algorithm. It delegates to `Array.prototype.sort`, and does not
  implement radix, counting, or top-K sorting.
- Not locale-aware collation.
- Not a comparator for values outside the schema's output domain. Like every
  other compiled operation, it assumes valid input and does not validate.
- Not a runtime-configurable ordering. Criteria are part of the plan, because
  that is what makes them compile away.
