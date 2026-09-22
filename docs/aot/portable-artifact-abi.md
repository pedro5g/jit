# Portable Artifact ABI

The portable ABI is the structural JavaScript/TypeScript contract shared by a
runtime result and a standalone generated artifact. It deliberately does not
expose JIT classes, registries or compiler plans.

## Validation

```ts
export interface ValidationIssue {
  readonly path: readonly PropertyKey[];
  readonly code: string;
  readonly expected: string;
  readonly message: string;
  readonly received?: string;
  readonly params?: Readonly<Record<string, unknown>>;
}

export class ValidationError extends Error {
  readonly code: "VALIDATION_FAILED";
  readonly issues: readonly ValidationIssue[];
}
```

The issue code and params are the machine contract. Messages are presentation
and may be customized without changing control flow. Rejected input is not
stored in an issue. A domain assertion carries its rule and field, not the
rejected value.

The runtime may continue to expose `JITValidationError` and `JITError` for
compatibility. A generator emits the structural error names by default. The
explicit `portableErrors: false` option remains a temporary compatibility
escape hatch for consumers that still assert the legacy generated class name.
In either mode, parity is checked through `code`, `issues`, `path` and
observable failure behavior, never through `instanceof` across hosts.

## Other portable boundaries

- Classes expose only their declared constructor/factory, fields and
  capabilities. The generated class does not retain a Runtime Class registry.
- Domain events are plain envelopes with their declared type, payload and
  metadata. Event protocol versions are explicit capabilities.
- Query results are declared output values or iterators. Query AST and
  `PhysicalQueryPlan` nodes never cross the artifact boundary.
- Serialization is a string, byte array or declared iterator boundary; helpers
  are emitted only when the selected operation needs them.
- Async operations preserve their `Promise` output and failure semantics; an
  artifact never imports an async runtime helper just to identify the promise.
- Protocol adapters are structural objects with a version, vendor/provenance
  string and the protocol method required by the selected capability.

## Standard Schema ownership

The boundary determines whether `~standard` is valid:

| Boundary | Input | Output | Standard Schema |
| --- | --- | --- | --- |
| schema / parser | `unknown` | validated value | yes |
| `json.parse(schema).validate()` | JSON text | validated value | yes, with its own adapter |
| `validate.is(schema)` | `unknown` | `boolean` type guard | no |
| `validate.safeParse(schema)` | `unknown` | result envelope | no |

An AOT artifact that declares `standard-schema/v1` emits the adapter as
structural code in the same module. It does not import JIT. A JSON pipeline
never reuses a schema adapter because its input is text rather than the schema's
input.

## Protocol ownership matrix

| Boundary | Runtime shape | AOT capability | Manifest protocol | Invalid attachment |
| --- | --- | --- | --- | --- |
| Schema/parser | `unknown -> validated value` | structural `~standard` adapter | `standard-schema/v1` | skipped with a boundary mismatch |
| JSON parser + validation | `string -> validated value` | its own structural adapter | `standard-schema/v1` on the pipeline export | never aliases the schema adapter |
| `validate.is` | `unknown -> boolean` | callable only | none | rejected as incompatible |
| `validate.safeParse` | `unknown -> result` | callable only | none | rejected as incompatible |
| JSON Schema document | `schema -> JSON object` | document value only | `standard-json-schema/v1` | never emits `~standard` |
| CQRS query | rows/params -> declared result | compiled query plus V1 descriptor | `standard-query/v1` / `~query` | physical strategy stays private |
| Domain event | event envelope -> event instance | structural `~event` metadata | `event-v1` | event version remains explicit |

Capabilities are selected at the artifact boundary. An AOT generation that
exports only `isUser` does not receive parser, JSON Schema or diagnostics
machinery; an export that opts into a protocol receives only the adapter needed
for that protocol. Runtime and AOT parity compares the boundary input/output,
issue codes and observable metadata rather than host-specific classes.

## Non-goals

The ABI is not a persistence format for compiler IR, a source map replacement,
or a promise that generated source has stable private helper names. The manifest
and semantic map answer contract questions; source retrieval remains an
explicit debugging operation.
