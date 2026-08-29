# jit Architecture

jit is a compiled data engine: a schema described once becomes specialized
JavaScript for every operation over that shape. This document describes the
project flow end to end and the rules every part follows.

User-facing feature guides live in [docs/features](./features/README.md).

## The pipeline

```text
DSL (JIT.* builders)
  -> Schema AST (core/ats: TypeName + defs + annotations + hints)
  -> per-operation plan / IR (compiler/ir, query plans, mapper plans)
  -> optimizer passes (equal and query only — separate cost models)
  -> codegen (one emitter per operation)
  -> globalThis.Function (runtime JIT)  |  one self-contained .js or typed .ts (AOT)
```

Everything expensive — schema traversal, wrapper resolution, hint
resolution, IR construction, optimization, source emission — happens once,
in the compilation path. The emitted function interprets nothing.

## Module map (`packages/jit/src`)

| Area           | Responsibility                                                                                                                                                                  |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `core/ats`     | schema AST: `TypeName`, def shapes, `ChecksDef`, `Typeof` type helpers                                                                                                          |
| `core/builder` | fluent chain (`.min()`, `.email()`, wrappers, hints); check methods are type-gated per schema kind                                                                              |
| `core/hints`   | manual strategy hints (`entity`, `indexBy`, `hash`, `ordered`, ...)                                                                                                             |
| `transforms`   | pure schema→schema transforms (`partial`, `pick`, `omit`, `merge`, wrappers)                                                                                                    |
| `compiler`     | one emitter per operation; shared IR (`ir/ir.ts`) + optimizer passes for equal and query; string emitters (validate/serialize/codec/scrub/stream) follow the same codegen rules |
| `runtime`      | compile cache, per-array index cache (legacy single-key slot plus plan entries), hash primitives, boundary scanner (stream), artifact registry                                  |
| `factories`    | the public `JIT.*` namespace: schema factories, callable capability artifacts, composition chains, and explicit `compile` aggregations                                          |
| `aot`          | Prisma-style generator (`generate`), schema discovery, config; `src/cli.ts` backs the `jit` binary                                                                              |
| `mcp.ts`       | MCP stdio protocol, tools/resources/prompts/completion dispatch; `mcp-project.ts` owns workspace-safe docs and AOT operations                                                   |
| `shared`       | source-emission helpers (`parse.ts`: escaping, identifiers, key access) and the `regexes` format library                                                                        |
| `errors`       | typed `JITError` / `JITValidationError`                                                                                                                                         |

## Schema AST

Every schema node keeps this stable runtime shape and property order:

```ts
{
  (type, _type, def, annotations);
}
```

- `_type` is a TypeScript phantom output type, always `null` at runtime;
  the assertion is centralized in schema construction.
- Definitions live in `def`; prefer stable def shapes over conditionally
  added properties.
- Checks (`min`, `email`, formats, ...) are declarative entries in
  `def.checks` with optional custom `message`; `JIT.coerce.*` is a `coerce`
  flag on the base def (zod semantics — not a wrapper).
- Transforms (`partial`, `pick`, `merge`, ...) return transformed schemas,
  not new AST node kinds.
- `JIT.iso.date/time/datetime/duration` are namespace factories over the same
  StringSchema checks as the legacy string chains. Native Date and Temporal
  remain separate runtime-value schema families.

## Codegen rules (non-negotiable, every emitter)

1. Runtime values ALWAYS travel as external bindings to `Function`
   (`__q0`, `__v0`, `__m0`, `__c0`) — never interpolated into runtime source.
   AOT may serialize safe literals, RegExp values and self-contained user
   callbacks after reconstructibility checks; native/bound functions and
   inaccessible closure dependencies are rejected.
2. Static keys only — no `for...in` / `Object.keys` on known shapes;
   classic indexed loops; no closures inside generated functions; no
   `push` (use `out[j++]`); checks ordered cheapest-first
   (`typeof` → null → numeric → length → regex).
3. Never invert `>` / `>=` / `<` / `<=` under `not` — NaN breaks the
   equivalence (De Morgan over and/or only; eq↔neq inversion is fine).
4. Large functions are split so V8 TurboFan can inline them; helper
   functions live at the top level of the compiled scope (typia-style
   `iu1`/`pu1` union predicates), never per-call closures.
5. Generated source is deterministic: `query.test.ts` asserts byte-exact
   goldens (fixed var names `value/len/out/j/i/item/entry/seen`, no Scope
   allocator) and `generated-source-snapshots.test.ts` locks composed
   scenarios behind snapshot review.

## Compile cache

`runtime/cache/compile-cache.ts` has two tiers:

- **Tier A** — `WeakMap schema → applied function` for operations whose
  bindings derive from the schema alone (equal, clone, diff, update, hash,
  validator, mask, sanitize, serialize, codec-per-version).
- **Tier B** — cached `{ source, create }` template, re-applying user
  bindings per compile (query, mapper). User values must never be cached
  into a shared closure.

Tier B templates also feed the **artifact registry**
(`runtime/artifact-registry.ts`): compiled query/mapper artifacts remember
their source + bindings, while validator and operation artifacts remember the
schema/op pair. `jit generate` uses that metadata to re-emit explicitly
exported standalone functions and dev-defined extras aggregated via
`{ ... }`.

## Validation engine

`compiler/validate/emit-validate.ts` emits up to three functions sharing
one binding list: `is` (early-return boolean), `safeParse` (issue vector +
single-pass output rebuild), and — when the schema contains promise
wrappers — `async safeParseAsync` (settles promises, validates resolved
values). Unions validate deeply through hoisted sync predicates;
discriminated unions dispatch on the literal tag. Output is returned by
reference when nothing rebuilds (`needsBuild` gates every allocation).

The public runtime capabilities `JIT.validate.is(schema)`, `JIT.validate.parse(schema)`,
and `JIT.validate.safeParse(schema)` lower to a shared ExecutionPlan and the same
validator compiler/cache. A composed source such as
`JIT.json.parse(schema).validate()` adds stages to that descriptor; it does
not introduce a second validation implementation. Removed selection facades
are not part of the runtime surface, while builder `schema["~standard"]`
closes over the compiled `safeParse` function for Standard Schema interop.

For schemas whose parse output is the input value and whose checks have no
observable callbacks or stateful regular expressions, generated `parse` uses
the allocation-free `is` program as its success path. Only invalid values run
the issue collector. Transforming and observable schemas remain single-pass.

## Composable execution lowering

`ExecutionPlan` is the common boundary contract for runtime and AOT. A final
artifact emits one `execution(input)` function and installs emitted validator,
query, mapper, transform, update, security, codec, and serializer helpers in
its lexical scope. It does **not** create the historical nesting of
`previous(value)` closures or compile each intermediate fluent artifact.

The current stage surface is deliberately explicit:

| Stage family               | Composition and physical behavior                                                                                                                                                                                                                                                                        |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| JSON / binary source       | JSON always uses native `JSON.parse`; runtime compilation performs bounded shape warm-up, then generated validation runs immediately after parsing. Binary uses the emitted codec.                                                                                                                       |
| Validation                 | Pure schemas use the allocation-free generated `is` path on successful `parse`; issue collection runs only after failure. Transforming or observable schemas use one generated `safeParse` pass.                                                                                                         |
| Runtime-class construction | A `construct` stage materializes a generated class only after its wire state validates. The class constructor receives an internal validated-state marker, so compiled validation is not executed twice. Standalone AOT construction requires the named class artifact to be emitted in the same module. |
| Query                      | Consecutive filter/select descriptors retain the final program and emit one indexed output loop.                                                                                                                                                                                                         |
| Mapping                    | Shape-specific single/batch mapper. A terminal batch map plus JSON sink serializes in the mapper loop and avoids the mapped output array.                                                                                                                                                                |
| Transform                  | Per-field emitted transform; collection mode emits an indexed loop. The target schema is explicit.                                                                                                                                                                                                       |
| Update                     | Schema-aware immutable patch; collection mode applies the static patch to each element in an indexed loop.                                                                                                                                                                                               |
| Security                   | `sanitize` and `mask` are emitted source rewrites, applied per value or per collection element.                                                                                                                                                                                                          |
| JSON / binary sink         | Specialized serializer or codec creates the final transport representation.                                                                                                                                                                                                                              |

“One execution function” must not be misread as “no allocations.” The
native `JSON.parse` still materializes its result, while codec
decoding, query output, mapper batches, collection rewrite stages, and sinks
are materializing boundaries when their semantics require values. In particular,
`filter(...).map(...)` may need the filtered array before the target-mapping
loop. Terminal map/JSON fusion removes the mapped collection, but does not yet
claim to remove every per-item target object. The planner preserves user order
and never crosses a throwing,
allocation, or external-binding boundary without a measured, semantics-tested
rule.

Runtime and AOT must lower the same plan in the same order. AOT accepts only
reconstructible callback bindings and static data-only update patches; it
reports a skip reason for values it cannot safely serialize. Every new stage
requires runtime, type, generated-source, runtime-AOT, and `define`-stub AOT
coverage. See [composable execution pipelines](features/composable-execution.md)
for the public contract.

Trusted application queries live under `JIT.cqrs`; untrusted request syntax
lives under the deny-by-default `JIT.api` boundary. `JIT.api.query` compiles
allowlisted fields, operators and structural limits into normalized query data
and never introduces a second query AST. `JIT.cqrs.query` lowers through the
same `QueryProgram` for object collections and through the existing binary
query compiler for rowsets. Query output is a
physical-plan choice. `.compile()` keeps the specialized
eager-array backend; `.to.iterator()`, `.to.asyncIterator()`, and
`.to.visitor()` select explicit incremental backends. The lazy emitter
fuses adjacent filter/select/control nodes, emits direct indexed array loops,
and records materialization barriers in `explain()`. Direct visitors avoid the
iterator protocol for fusible pipelines. Cardinality-changing operators use
separate generator stages so their state remains local and deterministic.

Join semantics extend the same CQRS program without exposing the physical plan.
`JoinPlan` reuses scalar key resolution, `IndexDescriptor` and the per-array
index cache. Compatible ordered inputs lower to a two-cursor `MergeJoin`; a
keyed right collection lowers to `IndexedJoin`; otherwise one `HashJoin` build
precedes the left scan. The generated program contains neither a nested linear
search nor a join-strategy dispatcher.

Distinct semantics also stay in `QueryProgram`. `DistinctDescriptor` selects a
scalar key table, allocation-free adjacent comparison for matching ordering,
a compound-key trie, or structural hash with compiled-equality confirmation.
No physical strategy name is serialized through `~query`.

Immutable state evolution lives under `JIT.state`: update, patch, reconcile
and watch keep their independent descriptors and specialized emitters. The
namespace is not a state runtime. `UpdateIRProgram` already delays parent
allocation until a child changes and preserves unchanged references, and
`MutationPlan` is extracted around that baseline rather than over it. A patch
declared in code lowers to normalized writes, a read/write set and a copy tree;
dead writes, sibling writes under one parent and mutations that write nothing
are resolved before emission. A path is specialized only when the generic
update would assign its leaf, so a declared patch cannot change what a
deep-partial patch means. `ChangedDescriptor` provides the current path-to-bit
layout that mutation and derived computation will generalize without changing
existing mask values.

Versioned schema evolution uses an immutable `MigrationDescriptor`. Every edge
is the existing MapperPlan; one generated version switch falls through only
the remaining edges. Current-version values return by reference. Runtime and
AOT therefore share the dispatch without a migration registry or runtime
schema inspection.

CSV and NDJSON are transport plans rather than generic text helpers. CSV emits
an RFC 4180 state machine, resolves headers once, converts known scalar columns
and validates each row. NDJSON reuses incremental UTF-8/line boundaries and can
fuse semantic `where` plus ProjectionTree selection into its serializer. Its
fused sink parses, validates, filters and serializes each row without a result
array or projected object. Both formats expose explicit iterator/visitor sinks
and standalone AOT artifacts.

The package exposes transitional host entrypoints while the monorepo is still
single-package: `@jit-compiler/jit/runtime` exports the runtime `JIT` namespace, and
`@jit-compiler/jit/define` exports the same schema DSL with AOT stubs for compiled
artifacts. `core/host.ts` owns the shared `CompilerHost`,
`CompilationRequest`, `CompiledArtifact`, descriptor symbols, and AOT artifact
types that future package splits will reuse.

## Wire formats (breaking-change surface)

- **Binary codec v2** (`compiler/codec/emit-codec.ts`): byte 0 is the
  schema version; object optionals are a 2-bit-per-field bitmask; ints are
  guarded int32; strings length-prefixed UTF-8 written via
  `TextEncoder.encodeInto`. Changing any layout detail is a breaking wire
  change — bump the version byte semantics deliberately.
- **Binary rowsets** (`compiler/binary-rowset.ts`): in-memory only, not a
  transport format. Flat object arrays compile into fixed-width rows in one
  `ArrayBuffer`; optionals/nullables use 2-bit row masks, string/literal
  fields use per-field integer dictionaries, and `JIT.cqrs.query(rowset)` emits
  byte-offset scans. The adaptive memory layout keeps mixed rows packed, uses
  typed views when naturally aligned, and supports explicit aligned and
  columnar modes. Columnar storage keeps one buffer with a leading mask plane
  and per-field contiguous lanes; generated queries bind only the column bases,
  views, and dictionaries they touch. Process plans mark projection-only
  strings adaptive: a bounded sample chooses canonical dictionary codes for
  repeated values or identity codes for high-cardinality values, while filter
  strings always stay indexed. Compatible object intersections are flattened;
  discriminated object unions use dense integer tags and variant-specific
  hydration. This layout may evolve independently from codec
  v2 because it is not persisted across processes.
- **Streaming** (`compiler/stream.ts` + `runtime/stream/boundary-scanner.ts`):
  the boundary FSM must survive tokens cut across chunks, including inside
  UTF-8 sequences. `JIT.csv` and `JIT.ndjson` add reconstructive transport
  plans over the same boundary principle; `JIT.stream.ndjson` remains the
  stateful `write/end/items` compatibility surface.

## AOT generator

Runtime/define/AOT parity is a public invariant. Every supported runtime
operation uses the same API through the define host, registers reconstructive
metadata and lowers to a standalone semantic equivalent. This does not require
byte-identical runtime and AOT source; it requires identical observable
behavior and public typing. Unsupported bindings produce explicit skip reasons
instead of a generic fallback or silent miscompilation. The full contract and
contributor matrix live in [AOT API parity](./aot/api-parity.md).

`aot/generate.ts` writes one executable source representation selected by
format. Output location never changes the code format:

- CLI/config generation defaults to typed `index.ts` in local directories;
  opt-in JavaScript receives one ready-to-run ESM `index.js` with no parallel
  declaration artifact;
- `output.perFile` compiles one module per declaration file, each standing
  alone and never importing the barrel;
- zero imports — the validation error class and runtime helpers
  (keyed-index cache, hash primitives) are inlined;
- export shape mirrors the declaration file: an artifact keeps the exact
  binding name (`const isUser = JIT.validate.is(User)` -> `isUser`), an object
  of artifacts emits one frozen object (`UserOps.is`), and a schema emits a
  named type (`export type User`) but no runtime function;
- the generator never emits an operation outside the selected surface: object
  markers use only the keys present in the compiled object; standalone output
  uses only exported registered functions;
- TypeScript output emits structural aliases and public function signatures in
  the executable `.ts` source. JavaScript deliberately emits no types. This
  removes the second hand-maintained representation that could drift from the
  code developers actually execute. Legacy source artifacts without complete
  runtime type metadata keep an erased type-only reference to their declaration
  module rather than degrading public types;
- validator codegen is selection-aware: an `is`-only artifact does not carry
  `safeParse`, async validation is absent unless it is the selected runtime
  capability, and `fromJSON` lowers native `JSON.parse` plus specialized
  validation directly without an intermediate parse wrapper;
- discovery loads each declaration file through a temporary sibling module
  that re-exports its private top-level bindings, so a schema kept local still
  names its generated type; self-contained callback bindings are emitted into
  the generated module, while native/bound functions and callbacks with
  inaccessible closure dependencies are skipped with a reported reason, never
  miscompiled.

CLI/config: `jit init` writes a typed `jit.config.*` plus a starter
`jit/user.jit.ts` using `@jit-compiler/jit/define`. `jit doctor` reports resolved
config/discovery without generating; `jit list` loads declaration files and
lists declared types, artifact objects and standalone artifacts;
`jit inspect <export> --stage plan|source` prints the
collected descriptor or generated review output; `jit clean` removes the
configured generated directory. `entries` is optional; when omitted,
`jit generate` scans from the project root. `entries` accepts files,
directories, and globs, with legacy `schemas` preserved as an alias.
`patterns` controls directory scans (default `**/*.jit.ts`). The scanner skips
`node_modules`, dot-dirs, and build output. If no buildable exported
functions/objects are found, the CLI warns and writes nothing. TypeScript
schema files load natively on runtimes that strip types, falling back to
`jiti` when installed.

## Reconstructive artifact boundary

The Rust workspace separates artifact concerns into three packages:

- `jit-artifact` is the filesystem-free protocol core. It wraps the pinned
  Rebyte canonical artifact envelope with the `jit1_` prefix, performs bounded
  decoding, validates portable relative paths and verifies BLAKE3 content and
  envelope digests.
- `jit-artifact-cli` owns native filesystem policy: config/flag resolution,
  symlink rejection, previews, whole-tree staging, atomic swaps, transaction
  journals and rollback.
- `jit-artifact-wasm` exposes only pack and inspect. It has no filesystem,
  process, network, hook, trust-store or signing API.

The web Lab is a free-form Monaco TypeScript editor. JIT declarations provide
IntelliSense; Monaco transpiles the source; and a terminable browser worker
evaluates it with the browser bundle of the real AOT compiler. Arbitrary Lab
source never executes on the server. The server receives only generated files,
canonicalizes them, stores them by SHA-256 and signs a compact `jlr1_`
reference with Ed25519. The private key never enters the browser bundle.

`jit-artifact-cli add` trusts the official HTTPS registry (or an explicit local
development override), resolves the signing key by its content-derived ID,
verifies the signature, downloads the immutable payload, verifies its SHA-256,
then reuses the same path confinement, preview, staging and transaction
machinery as offline `jit1_` artifacts. A `jlr1_` reference cannot contain
commands, dependencies or hooks. Offline `jit1_` tokens remain deterministic
unsigned envelopes that carry their complete files.

## Semantic and physical query planning

A query is lowered in two steps that must stay separate.

The **semantic plan** is what the caller asked for: `QueryProgram` nodes,
reachable through `~query` in portable form. It never names an algorithm.

The **physical plan** (`compiler/physical-query.ts`) is how the rows are
reached. It reads collection facts — `.keyed`, `.uniqueBy`, `.indexBy`,
`.ordered`, entity identity — and picks `Scan`, `EarlyExitScan`,
`CachedIndexLookup` or `BinarySearch`. It is private: `explain()` exposes the
strategy, the reason, the complexity and the facts, and nothing else. `~query`
carries no physical node at all, so an external adapter chooses its own path.

Rules that hold for every strategy added here:

- a strategy must never change the answer, and needs a differential test
  against the scan it replaces covering present, absent and boundary keys;
- a strategy that can lose to a scan documents the regime where it does, with
  the measured number;
- no public API asks the caller to name an algorithm.

Three descriptors are shared rather than re-derived per operation:

| Descriptor           | Module                 | Read by                                            |
| -------------------- | ---------------------- | -------------------------------------------------- |
| `OrderingDescriptor` | `compiler/ordering.ts` | `JIT.sort`, query `orderBy`, `compileSortBy`, lazy |
| `IndexDescriptor`    | `compiler/indexing.ts` | `JIT.index`, `CachedIndexLookup`                   |
| scalar key kinds     | `compiler/row-keys.ts` | both of the above                                  |

`row-keys.ts` is why a key means the same thing to a comparator and to an
index. Where they differ it is deliberate: ordering has a `numeric` fast path
for subtraction, while a `Map` matches keys with SameValueZero, so indexing
folds `numeric` into `direct`.

## Optimizer boundaries

Equal-only passes (inline-vars, optimize-cost, reorder-compares, ...) must
NOT run on query IR; query has its own `normalize-logic` +
`reorder-conditions` passes. Their cost tables intentionally differ — do
not unify without re-benchmarking.

## Conventions

- ESM; local imports use emitted `.js` extensions; `import type` for
  type-only edges; named exports preferred; no package-root imports inside
  the package.
- No new `any` outside deliberate boundaries; `// @ts-expect-error` (never
  `@ts-ignore`) for intentional invalid-API tests.
- Tests colocated under `__tests__`; typed APIs pair runtime assertions
  with `expectTypeOf`; benchmarks (mitata) live in `bench/` with results
  gitignored.

Verification:

```bash
pnpm format:check && pnpm lint:check && pnpm test && pnpm build
```
