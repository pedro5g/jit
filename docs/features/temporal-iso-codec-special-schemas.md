# Temporal, ISO, Codecs, And Special Schemas

JIT includes special schemas for real-world boundaries that normally force
custom validation code: Temporal values, ISO strings, JSON values, template
literals, function schemas, custom schemas, and bidirectional value codecs.

## Choose The Correct Date Model

JIT exposes three deliberately separate date families:

| Input at the boundary                       | Schema           | Inferred output | Typical use                                                 |
| ------------------------------------------- | ---------------- | --------------- | ----------------------------------------------------------- |
| Text from JSON, forms, headers, SQL drivers | `JIT.iso.*`      | `string`        | Validate syntax without allocating a `Date`                 |
| Existing JavaScript object                  | `JIT.date()`     | `Date`          | Legacy APIs, browser controls, database SDKs                |
| Temporal object with explicit semantics     | `JIT.temporal.*` | Temporal class  | Time zones, calendar dates, durations, precise domain logic |

Do not use `JIT.date()` for an ISO string: it validates `instanceof Date` and
its configured range. Do not use `JIT.iso.datetime()` when the application
already needs `Temporal.Instant`: validate the Temporal object directly or use
a value codec to cross the boundary once.

## ISO Strings

ISO formats are grouped under the same namespace style as Temporal:

```ts
const CalendarDate = JIT.iso.date();
const WholeMinute = JIT.iso.time({ precision: -1 });
const ApiTimestamp = JIT.iso.datetime({ offset: true, precision: 3 });
const Retention = JIT.iso.duration();
```

The legacy chains remain supported:

```ts
JIT.string().date();
JIT.string().time({ precision: -1 });
JIT.string().datetime({ offset: true });
JIT.string().duration();
```

Both surfaces append exactly the same declarative checks to a `StringSchema`.
They share validator codegen, cache entries, AOT behavior, errors, and output
type. `JIT.iso.*` is preferred in new code because it communicates the boundary
format before the method chain is read.

### ISO Date

`JIT.iso.date(message?)` accepts strict calendar dates in `YYYY-MM-DD` form.
It validates leap years and real month lengths.

```ts
const DateOnly = JIT.iso.date("expected an ISO calendar date");

DateOnly.is("2024-02-29"); // true
DateOnly.is("2025-02-29"); // false
DateOnly.is("2026-7-5"); // false
DateOnly.is("2026-07-32"); // false
```

This is a syntax/calendar check. It intentionally does not allocate a native
`Date`, apply a timezone, or reinterpret midnight.

### ISO Time

`JIT.iso.time(options?, message?)` validates local clock text with no timezone
suffix.

| `precision` | Accepted shape                                   | Example                   |
| ----------: | ------------------------------------------------ | ------------------------- |
|     omitted | minutes, optional seconds and arbitrary fraction | `03:15`, `03:15:00.12345` |
|        `-1` | minute precision                                 | `03:15`                   |
|         `0` | exact second precision                           | `03:15:00`                |
|      `1..n` | exact fractional digits                          | `03:15:00.123` for `3`    |

```ts
JIT.iso.time({ precision: -1 }); // HH:MM
JIT.iso.time({ precision: 0 }); // HH:MM:SS
JIT.iso.time({ precision: 3 }); // HH:MM:SS.sss
```

`24:00`, timezone suffixes, malformed fractions, and out-of-range minutes or
seconds are rejected.

### ISO Datetime

`JIT.iso.datetime(options?, message?)` combines the strict date and time rules.
The default requires `Z`:

```ts
const Utc = JIT.iso.datetime();

Utc.is("2026-07-05T12:00Z"); // true
Utc.is("2026-07-05T12:00:00.123Z"); // true
Utc.is("2026-07-05T12:00:00"); // false
Utc.is("2026-07-05T12:00:00-03:00"); // false
```

Use `offset: true` for `+02:00` or `-03:00`, and `local: true` only when the
domain genuinely accepts timezone-less wall-clock values:

```ts
JIT.iso.datetime({ offset: true });
JIT.iso.datetime({ local: true });
JIT.iso.datetime({ offset: true, local: true, precision: 3 });
```

Basic offsets such as `+0200` or `+02` are rejected. `precision` follows the
same rules as `JIT.iso.time()`.

### ISO Duration

`JIT.iso.duration(message?)` accepts ISO 8601-1 duration strings such as
`P4W` and `P3Y6M4DT12H30M5S`. It does not accept the broader ISO 8601-2 signed
and mixed extensions.

Use `JIT.temporal.duration()` when the input is already a `Temporal.Duration`
object and the application needs duration arithmetic.

## Native Date

`JIT.date()` validates actual, valid native `Date` objects. Date-like operators
compile to numeric epoch comparisons:

```ts
const CampaignDate = JIT.date()
  .min(new Date("2026-01-01T00:00:00.000Z"))
  .max(new Date("2026-12-31T23:59:59.999Z"));

const BusinessMinute = JIT.date()
  .between("2026-01-01", "2026-12-31")
  .daysOfWeek([1, 2, 3, 4, 5])
  .monthsOfYear([1, 2, 3, 4, 5, 6])
  .truncateTo("minute");
```

| Operator                | Meaning                                                           |
| ----------------------- | ----------------------------------------------------------------- |
| `.min(value)`           | epoch must be greater than or equal to the bound                  |
| `.max(value)`           | epoch must be less than or equal to the bound                     |
| `.between(min, max)`    | inclusive range                                                   |
| `.daysOfWeek(days)`     | JS weekday numbers, Sunday `0` through Saturday `6`               |
| `.monthsOfYear(months)` | calendar months `1..12`                                           |
| `.truncateTo(unit)`     | rejects non-zero fields below minute/second/millisecond precision |

String bounds are resolved by the compiler path, not reparsed for every
successful call. Invalid `Date` values (`Number.isNaN(date.getTime())`) fail.

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

Temporal constructors are checked directly. The test setup installs
`@js-temporal/polyfill` where the host runtime does not expose Temporal yet;
production applications should provide the same polyfill on engines without
native support.

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
"hello, Ada!";
```

Template literal schemas are useful when a protocol or CSS-like string format
has fixed pieces and typed holes.

## Function Schema

```ts
const MyFunction = JIT.function({
  input: [JIT.string()],
  output: JIT.number(),
});

const computeTrimmedLength = MyFunction.implement(
  (input) => input.trim().length,
);
const computeTrimmedLengthAsync = MyFunction.implementAsync(
  async (input) => input.trim().length,
);
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
function commonNumberChecks<T extends ReturnType<typeof JIT.number>>(
  schema: T,
) {
  return schema.min(0).max(100);
}

const Percentage = JIT.number().apply(commonNumberChecks);
```

Callbacks are runtime values. They work in runtime JIT, but AOT generation will
skip artifacts whose callbacks cannot be serialized safely.

## Value Codecs

Value codecs transform in both directions:

```ts
const stringToDate = JIT.codec(JIT.iso.datetime(), JIT.date(), {
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

For ISO strings, regex construction happens when the schema is built. The
compiled validator receives the regex as a stable external binding in runtime
JIT or emits the safe regex in AOT. The hot path performs a string type gate
and one `.test()`; it does not call `Date.parse`, allocate a `Date`, load a
timezone database, or interpret a generic schema tree.

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
- Prefer UTC or explicit offsets for transport timestamps. Use `local: true`
  only for domains such as appointment wall time where a zone is supplied
  separately.
- Validate ISO text first and decode once. Repeated string-to-Date conversion
  inside filters is both ambiguous and more expensive than a boundary codec.
- Keep calendar dates as `JIT.iso.date()` or `Temporal.PlainDate`; converting a
  birthday or billing day into midnight UTC introduces timezone bugs.

## Comparison With Other Libraries

- Zod 4 also groups ISO strings under `z.iso.*` and provides bidirectional
  codecs. JIT follows the same discoverable split while compiling only the
  selected operation and supporting import-free AOT output.
- Valibot exposes ISO validation as modular pipe actions. That model is strong
  for source-level tree shaking; JIT moves the full composed check into one
  generated function and can remove the schema runtime entirely in AOT.
- TypeBox models JSON Schema formats and can compile validators. It is the
  better fit when JSON Schema interchange is the primary artifact; JIT keeps
  richer non-JSON operations such as query, mapper, binary rowset, and update
  attached to the same schema.
- Typia generates from TypeScript types and tags at build time. It avoids a
  runtime schema declaration but requires transformer/generator setup. JIT
  supports both runtime compilation of dynamic schemas and explicit AOT.

These are architectural comparisons, not cross-project benchmark claims.
Performance numbers in this repository come only from the pinned local suites.
