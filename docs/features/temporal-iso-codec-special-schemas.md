# Temporal, ISO, Codecs, And Special Schemas

JIT includes special schemas for real-world boundaries that normally force
custom validation code: Temporal values, ISO strings, JSON values, template
literals, function schemas, custom schemas, and bidirectional value codecs.

## Temporal

```ts
const MeetingTime = JIT.temporal
  .plainTime()
  .min("09:00:00")
  .max("18:00:00")
  .truncateTo("minute");

const BusinessDate = JIT.temporal
  .plainDate()
  .between("2026-01-01", "2026-12-31")
  .daysOfWeek([1, 2, 3, 4, 5]);
```

Supported Temporal families include:

- `instant`
- `plainDate`
- `plainTime`
- `plainDateTime`
- `zonedDateTime`
- `plainYearMonth`
- `plainMonthDay`
- `duration`

Temporal checks also include `.monthsOfYear()` and `.truncateTo()`.
`truncateTo("minute")`, for example, validates that seconds and milliseconds
are not present where the domain expects whole minutes.

## Date And ISO Strings

Date-like checks are available for native `Date`, ISO date/time strings, and
Temporal schemas where the check makes sense:

```ts
JIT.string().datetime({ offset: true, precision: 3 });
JIT.string().date();
JIT.string().time({ precision: -1 });
JIT.date().min(new Date("2026-01-01")).max(new Date("2026-12-31"));
```

Precision is encoded as schema metadata, so generated validators can run
direct regex/field checks without calling a full date library in the hot path.

## JSON Value

Use `JIT.json()` to validate JSON-encodable values:

```ts
const JsonValue = JIT.json();
const isJson = JIT.validate(JsonValue).is().compile();
```

This is useful at storage, message, or RPC boundaries where unknown values must
be JSON-safe before serialization.

## Template Literal

```ts
const Greeting = JIT.templateLiteral(["hello, ", JIT.string(), "!"] as const);
```

This describes values like:

```ts
"hello, Ada!"
```

Template literal schemas are useful when a protocol or CSS-like string format
has fixed pieces and typed holes.

## Function Schema

```ts
const MyFunction = JIT.function({
  input: [JIT.string()],
  output: JIT.number(),
});

const computeTrimmedLength = MyFunction.implement((input) => input.trim().length);
const computeTrimmedLengthAsync = MyFunction.implementAsync(async (input) => input.trim().length);
```

Function schemas validate inputs and, when an output schema is provided, the
return value. Use them for plugin boundaries and user-provided callbacks where
runtime safety matters more than a bare function type.

## Custom And Apply

Use `JIT.custom()` when a third-party type cannot be described structurally:

```ts
const DecimalSchema = JIT.custom<Decimal>((value) => Decimal.isDecimal(value));
```

Use `.apply()` to package reusable schema chains:

```ts
function commonNumberChecks<T extends ReturnType<typeof JIT.number>>(schema: T) {
  return schema.min(0).max(100);
}

const Percentage = JIT.number().apply(commonNumberChecks);
```

Callbacks are runtime values. They work in runtime JIT, but AOT generation will
skip artifacts whose callbacks cannot be serialized safely.

## Value Codecs

Value codecs transform in both directions:

```ts
const stringToDate = JIT.codec(JIT.string().datetime(), JIT.date(), {
  decode: (iso) => new Date(iso),
  encode: (date) => date.toISOString(),
});
```

This is different from the binary wire codec. Value codecs model a domain
conversion between input and output schemas. Binary codec is a transport format
for compact bytes.

## Why These Are Fast

Special schemas avoid generic custom code in common cases:

- ISO checks compile to regex/precision guards;
- Temporal checks compile to constructor and field comparisons;
- JSON checks compile to structural traversal;
- template literals compile to fixed-prefix/suffix validation;
- codecs separate validation from transformation so each side can be compiled.

Using built-ins keeps the compiler aware of the shape. That is what lets JIT
emit direct code instead of calling opaque user predicates for every value.

## Why They Use Less Memory

Built-in checks avoid allocating wrapper objects around custom validators.
For codecs, output is rebuilt only when a transform is part of the schema.
For Temporal and Date checks, comparisons use existing values instead of
parsing into intermediate date libraries in the hot path.

## Best Practices

- Prefer built-in ISO/Temporal schemas over ad hoc `.regex()` when available.
- Use `.truncateTo()` for domain precision, not just formatting.
- Use value codecs for domain conversion, binary codec for transport.
- Keep custom callbacks at runtime boundaries unless you explicitly accept
  that AOT cannot serialize them.
