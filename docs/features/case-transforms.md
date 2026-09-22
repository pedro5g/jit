# Case validation and transforms

Case rules are schema operations, so JIT can specialize them once and reuse
the same semantics in runtime validation, JSON Schema metadata and AOT output.
The API separates checking a canonical value from converting a value.

## API

Validation methods reject non-canonical input and preserve the accepted value:

```ts
const UserName = JIT.string().camelCase();
const EnvironmentKey = JIT.string().upperSnakeCase();

UserName.is("adaLovelace"); // true
UserName.is("Ada Lovelace"); // false
EnvironmentKey.is("API_BASE_URL"); // true
```

Transform methods run in parse-capable operations and return the normalized
string:

```ts
const Header = JIT.string().toKebabCase();

Header.parse("Content-Type"); // "content-type"
Header.is("Content-Type"); // false: `is` does not materialize transformed output
```

The supported styles are `lower`, `upper`, `camel`, `pascal`, `snake`,
`kebab`, and `upper-snake`. Their fluent names are:

| Validation | Transform |
| --- | --- |
| `lowercase()` | `toLowerCase()` |
| `uppercase()` | `toUpperCase()` |
| `camelCase()` | `toCamelCase()` |
| `pascalCase()` | `toPascalCase()` |
| `snakeCase()` | `toSnakeCase()` |
| `kebabCase()` | `toKebabCase()` |
| `upperSnakeCase()` | `toUpperSnakeCase()` |

The methods use JavaScript identifier names. `toSnakeCase()` and
`toUpperSnakeCase()` are the public spellings; names containing `_` or `-`
are not API identifiers.

## Compiler design

All case operations lower to one `CaseTransformPlan` with an operation
(`validate` or `transform`) and a `CaseStyle`. The tokenizer handles ASCII word
boundaries, camel-case transitions, acronym transitions and separators.
Compound styles use one generated helper only when the selected parse
operation needs it; `is()` emits a direct comparison and no output allocation.

Validation has linear time complexity in the input length and returns the
original string reference. A transform is also linear, but may allocate the
normalized string and its temporary word array. No runtime registry or generic
callback is involved in the hot loop.

The JSON Schema emitter represents validation styles with deterministic regular
expression patterns. Transform-only semantics are intentionally not represented
as validation constraints because JSON Schema cannot describe an output rewrite.

## Runtime, define and AOT parity

The same `StringCheck` AST is used by the runtime and define hosts. AOT emits
the case helper inline in the generated module, so generated code has no import
from JIT. Runtime and AOT tests cover every style, the validation/transform
distinction, `is()` allocation behavior and parse output.

## Measurement

The reproducible case benchmark is `pnpm bench:case`. It checks the same
result through idiomatic JavaScript, a handwritten character-code loop, the
runtime JIT and the standalone AOT function. One run on Node `v22.17.1`
(`linux-x64`, 200,000 calls and three hot rounds) produced:

| implementation | hot ns/call | heap delta |
| --- | ---: | ---: |
| idiomatic JavaScript | 910.077 | -6,320,592 B |
| handwritten loop | 486.129 | 5,090,496 B |
| runtime JIT | 1,928.839 | -1,480,128 B |
| AOT | 1,946.411 | -1,480,184 B |

The AOT source was 2,068 bytes; generation took 8.009 ms and module
compilation took 4.250 ms. Heap deltas are process-level observations and are
GC-sensitive, so they are reported for reproducibility rather than treated as
allocation counts. The measured result is intentionally not flattering: the
handwritten loop wins this fixture, while runtime and AOT preserve the shared
semantics with no JIT dependency in the emitted module.

The naming profile gate is independent and reproducible with
`pnpm bench:naming`. It emits the same group with compact and semantic helper
names. In the same environment, compact and semantic both produced 4,772
bytes and a 464-byte observed heap delta; hot medians were 130.553 ns/call and
162.830 ns/call respectively. Generation took 18.440 ms / 3.248 ms and module
compilation took 116.217 ms / 17.890 ms for compact / semantic. Those timings are one local run, not a universal
performance claim. The acceptance criterion remains semantic parity and no
added work for validation-only `is()`.

## Non-goals

These operations do not provide locale-specific collation, transliteration or
Unicode title-casing. They also do not change object keys. Key naming belongs to
a separately measured mapper policy and must not be confused with transforming
a string value.
