# JIT Agent Guide

This repository contains **JIT**, a TypeScript library for describing data structures once and compiling specialized JavaScript operations over those structures.

Read [docs/architecture.md](docs/architecture.md) before substantial architecture or migration work. It contains the full project context, target architecture, migration plan, performance principles, and definition of done for the initial typed operator-chain work.

If `docs/internal/STATUS.md` exists, read it first — it is a local-only (gitignored) snapshot of current project state and pending work.

## Workflow

- Use `pnpm`.
- Do not use `npm`, `yarn`, or `bun` unless explicitly requested.
- Inspect the real implementation before changing code.
- Preserve legacy behavior until compatibility tests prove a replacement.
- The legacy `DSL` and `ATS` directories have been migrated to the namespace-based `JIT` factories/core and removed. Do not reintroduce them.
- Keep `equal` and `shared` compatibility code unless their replacements have compatibility coverage.
- Keep changes scoped to the current stage.
- Check the worktree before editing and do not revert unrelated user changes.

## Commands

Root scripts:

```bash
pnpm format:check
pnpm lint:check
pnpm test
pnpm build
```

Write commands:

```bash
pnpm format
pnpm lint
pnpm fix
```

Use write commands deliberately and inspect the resulting diff.

## Module Conventions

- The project is ESM.
- TypeScript source imports must use emitted JavaScript extensions when importing local modules:

```ts
import type { TypeSchema } from "./type-schema.js";
import { TypeName } from "./type-name.js";
```

- Use `import type` for type-only dependencies.
- Do not import from the package root inside the same package.
- Avoid making namespace barrels dependency-cycle hubs.

## Namespace Pattern

The project intentionally uses namespace-oriented exports:

```ts
export * as Equal from "./equals.js";
export * as Parse from "./parse.js";
export * as Utils from "./utils.js";
export type Equal<T = unknown> = import("./types.js").Equal<T>;
```

Preserve this style where it improves API navigation and compatibility. Runtime namespace exports and type aliases may share a public name.

## Callable Operators

Callable functions may have attached static operations when the property is a stable specialization of the same operation:

```ts
Equal.array(childEqual);
Equal.array.writable(childBuilder);
```

Prefer explicit callable interfaces for new code. Do not turn functions into arbitrary property containers.

## Schema Shape

The new AST must use a stable runtime shape:

```ts
{
  type,
  _type,
  def,
  annotations,
}
```

Rules:

- `_type` is a TypeScript phantom output type.
- `_type` must be `null` at runtime.
- Centralize the assertion that makes `_type` typed while storing `null`.
- Preserve property order: `type`, `_type`, `def`, `annotations`.
- Prefer stable definition shapes over conditionally added properties.

Legacy schemas may still use fields such as `item`, `props`, `schemas`, `literalValue`, and `enumObject`. Treat them as compatibility concerns during migration.

## Typing

- Avoid new `any`.
- Use `unknown`, precise generics, conditional types, mapped types, and discriminated unions.
- Public legacy aliases may keep old defaults such as `Equal<T = any>` when required for compatibility.
- Every new `any` must be a deliberate compatibility boundary, external-library boundary, or isolated implementation signature hidden behind precise public types.
- Use `// @ts-expect-error` for intentional invalid API tests. Do not use `@ts-ignore`.

## Builders And Transforms

- Keep schema AST separate from the fluent builder chain.
- Keep schema builders separate from compiler/code-generation builders.
- Do not use `Proxy`.
- Builder instances should have a small, stable shape, ideally `{ schema }`.
- Share methods through prototypes, classes, or another allocation-conscious mechanism.
- `partial`, `required`, `pick`, `omit`, `extend`, and `merge` are transforms over existing schemas, not new AST node types.
- Transform functions should be independent from builders.

## Execution Plans, Runtime Classes, And DDD

- New boundary composition belongs in an immutable `ExecutionPlan`; lower it once
  to one specialized function rather than chaining runtime closures.
- A `construct` stage may materialize a Runtime Class only after a validation
  stage establishes `schema-validated`. Pass the internal validated-state marker
  only across that proven boundary; ordinary constructors and `with()` must
  retain validation.
- AOT output must never capture runtime constructors, descriptors, registries,
  or the JIT package. A class-construction pipeline is AOT-compatible only when
  its named Runtime Class artifact is emitted in the same generated module.
- Capabilities are immutable descriptors installed once on a prototype. Keep
  them tree-shakeable and do not add per-instance infrastructure for methods.
- Runtime Types have one construction boundary. `JIT.class` defaults to
  constructor mode, DDD presets default to factory mode, and
  `.construction(...)` may replace that boundary but never add a second one.
- Singleton class policies such as validation, construction, timestamps,
  soft-delete and versioning must reject repeated configuration in both the
  fluent type and runtime surface. Assertions and prototype extensions remain
  repeatable because each invocation declares another independent item.
- `valueObject`, `entity`, `aggregateRoot`, and `domainEvent` reuse Runtime
  Class machinery. Aggregates keep controlled mutation and an ordered event
  buffer; readonly schema fields stay out of patches. These DDD presets live
  under the `JIT.ddd` namespace and preserve canonical `create()`/`hydrate()`
  names. `JIT.class` stays top level: it is the primitive the presets
  configure, and non-domain features build on it directly.
  Domain-event `create()` accepts payload input, while direct construction and
  hydration use the complete event envelope. Rename factories only through an
  explicit `.factories(...)` call.
- Abstract DDD bases live only under `JIT.ddd.abstract`; watched aggregate
  collections live only under `JIT.ddd.watchedList`.

Runtime types expose one canonical construction boundary. `JIT.class` defaults
to direct construction; DDD value objects, entities, and aggregate roots
default to factory construction. Do not expose both direct `new` and factories
by default. Create semantics may resolve defaults; hydrate semantics never
regenerate persisted defaults.

Nested Runtime Types accept their boundary representation and materialize
recursively. Scalar Value Objects are runtime objects with a readonly `value`
accessor, never primitive intersections with methods. Identity inference may
use identifier metadata only when exactly one unambiguous candidate exists.

Factory validation and domain assertions are opt-in and add zero work to
unconfigured classes. A factory result policy is fixed at artifact declaration
and reflected exactly in its types. Class capabilities reuse existing compiler
plans; do not create separate clone, validate, or diff engines for classes.

State collection mutation reuses shared AccessPath planning and the element's
MutationPlan. Do not implement collection filtering, mapping, or grouping under
state when CQRS already owns those semantics.

## Tests

- Use Vitest.
- Colocate package tests under `__tests__` directories.
- Follow the style used by `packages/jit/src/factories/__tests__/factories.test.ts`: nested `describe` groups such as `primitives`, `collections`, `complex structures`, `literal`, `modifiers and chains`, and `object operators`; each test should pair runtime schema assertions with `expectTypeOf` inference assertions.
- Test both runtime behavior and type inference for typed APIs.
- Keep regression tests between legacy and new implementations during migration.
- Generated-source tests must verify deterministic source and behavior.

## Code Generation

- `new Function` belongs only in the compilation path.
- Never interpolate untrusted runtime values into generated source.
- Use external bindings for predicates, transforms, constructors, regular expressions, custom comparators, and unsafe literals.
- Centralize source helpers for identifier validation, string escaping, property access, literal emission, and binding allocation.
- Generated code should be readable, deterministic, and engine-friendly.

## The Site And Its Assistant (apps/site)

The documentation assistant answers from generated context rather than from the source
tree, so changing the public API, the documentation or the workspace leaves it holding a
description of a library that no longer exists. **Rebuild that context in the same change**,
from `apps/site`:

```bash
pnpm knowledge:build   # compile docs, symbols, routes, indexes and embeddings
pnpm knowledge:validate # validate the generated knowledge in memory
pnpm gen:dts           # Monaco declarations for the workspace
pnpm gen:lab           # browser AOT bundle used by Generate and by example verification
pnpm audit:docs        # executes every documentation example against the real library
pnpm eval:ghost        # retrieval against the golden question set
```

The copilot has no hand-written concept graph or duplicated fact catalog. Knowledge is
compiled from the runtime surface, documentation, routes and executed examples. A fact
that can be extracted from a real source must not be added to the prompt by hand.

Rules the assistant and workspace are held to:

- No unaudited answer is shown. Fatal audit findings fail closed after at most one
  constrained retry. Schema generation uses validated `SchemaIntent` and deterministic
  code generation; the model never writes JIT syntax for that path.
- Generative behaviour is beta and says so. The verified floor (retrieval, compiled
  symbols and documentation examples) is what the product promises; the model is a
  language layer on top.
- The workspace holds a project. `lib/workspace/project.ts` owns path rules, identical to
  the artifact protocol's, and `lib/workspace/bundle.ts` links files so each dependency
  keeps its own scope.
- The entrypoint import line belongs to the workspace and is restored when edited.

### The copilot's knowledge and its measurement (lib/copilot)

The copilot engine replaced the hand-written graph assistant after the retrieval and
generation measurements established the migration boundary. Its knowledge is compiled
rather than written:

```bash
pnpm knowledge:build      # compile docs, API surface and routes into versioned artifacts
pnpm knowledge:validate   # in-memory; an unregistered route or dangling relation fails CI
pnpm knowledge:benchmark  # generation, one process per configuration, writes .eval runs
pnpm knowledge:label      # adjudication sheet + empty label scaffold for a run
pnpm knowledge:rescore    # re-score saved transcripts with today's detectors, no generation
```

- Detection is not policy. A validator reports what it found, the audit aggregates and
  classifies, and an `AuditPolicy` decides what the product does. Never move a severity
  decision into a detector.
- The model is never a source of truth, and neither is a second model. There is no
  LLM judge anywhere in the eval path: a judge's verdicts are the one thing nothing else
  could check.
- A benchmark run is an artifact — manifest, cases, contexts, responses — written as soon
  as its configuration finishes. Runs and reports are regenerable and ignored; the
  hand-read labels under `.eval/copilot/labels/` are ground truth and are committed.
- A detector's precision and recall are measured against those labels, never against its
  own output, and a bad score is a finding rather than a reason to move a threshold.
- The headless light tier is not the browser's. Qwen3.5-0.8B does not load under
  `onnxruntime-node`, so the headless floor is a smaller model and its numbers are a lower
  bound on the browser tier, never an estimate of it. Never quote one table as the other.

## Performance Principles

- Avoid work.
- Specialize when schema information is known.
- Preserve stable object shapes.
- Avoid unnecessary allocation and indirection.
- Avoid generic callbacks in hot loops.
- Prefer direct property access for known paths.
- Benchmark before accepting complexity.
- Distinguish compile-time cost from execution-time cost.

## Feature Acceptance

Every new public operation must solve a measured problem.

Before implementation:

1. audit existing operations and IR;
2. document what can be reused;
3. define the expected complexity or allocation improvement;
4. build a handwritten optimized ceiling benchmark when possible.

Do not add a public operation only for API convenience if specialization cannot
avoid work, allocations, materialization, indirection, or improve algorithmic
complexity. Start by asking whether the operation, allocation, intermediate
value, callback dispatch, or full scan can be avoided entirely.

## Runtime / AOT Parity

The public API is one-to-one between runtime and define/AOT hosts.

Every new runtime artifact must:

- be expressible through `@jit-compiler/jit/define` with the same API;
- register reconstructive metadata;
- generate a standalone AOT equivalent in JavaScript and typed TypeScript when applicable;
- preserve public typing and runtime semantics;
- have runtime/AOT semantic parity tests;
- have deterministic generated-source coverage;
- have a focused tree-shaking fixture.

AOT declaration discovery treats the module's explicit exports as its public
manifest. Private schemas, artifacts and artifact objects are build-time
implementation details and must not be emitted. A structural type is emitted
only for an explicit `export type Name = JIT.Typeof<typeof schema>` declaration
or an equivalent type-only export of that alias.

Composed operations must lower as one optimized AOT program where fusion is
safe. API parity does not require byte-identical source, but both hosts must
preserve the same observable contract. Unsupported runtime bindings must be
reported as explicit AOT skip reasons and must never be silently miscompiled.

## Query

`JIT.cqrs` is the only public query namespace. Query construction, parameters,
and compiler literals live under `JIT.cqrs`; do not add top-level query aliases.
Reuse the existing query AST and `QueryProgram`; do not create a second query
engine.

Keep the structural `~query` protocol at version 1 until a published external
compatibility boundary exists. Evolve V1 deliberately when needed, and never
expose private `QueryProgram` or `PhysicalQueryPlan` nodes through the standard.

Semantic query plans describe what is requested. Schema facts and collection
hints feed a separate physical planner that chooses how to execute it. Explain
output must make the selected strategy, materialization barriers, expected
complexity, and relevant facts reviewable, and must not expose access-path
internals or query AST nodes.

A physical strategy must never change the answer. Every access path needs a
differential test against the scan it replaces, covering present, absent and
boundary keys. A strategy that can lose to a scan must document the regime
where it does, with the measured number — an index that is rebuilt instead of
reused is slower than the scan it replaced, and the documentation says so.

Do not add a public operation that asks callers to name an algorithm. The
query describes the request; facts on the collection decide the access path.

## Access Control

- Access conditions reuse the Query AST; never create a second access-expression language.
- Authorization must lower away before `~query`; the protocol never exposes AccessPlan, ability, rule, or diagnostic nodes.
- Keep `can()` allocation-free. Diagnostics and field materialization must not add work to that boolean path.
- Fuse authorization with query, projection, update, and patch lowerings when safe; AOT must not retain a rule walker or ability middleware.
- Do not add storage-specific authorization adapters to core. Datastores consume the normalized `~query` predicate and projection.

## Rules

- Rule conditions reuse the shared condition/query AST; never create a second rules-expression language.
- Do not create runtime operator registries or fact-name registries for static rules.
- Rules are pure by default: consequences are data, not side effects. Do not add callbacks to the rule hot path when a declarative descriptor can represent the operation.
- Rules must preserve runtime/define/AOT 1:1 parity, one reconstructive artifact per result mode.
- Execution sinks must avoid allocations they do not semantically require: `test`, `some`, `first` and `predicate` allocate nothing, and the visitor sinks allocate only what the consumer takes.
- Facts shared between rules are evaluated at most once per full evaluation, and loop-invariant work leaves the `many()` loop. Early-exit sinks do not hoist: that would perform work the short circuit was entitled to skip.
- Diagnostics (`explain`, `inspect`) must not add cost to the normal evaluation path.
- A rule predicate consumed by `JIT.cqrs` lowers to a plain query condition with its inputs as bindings; no rule, fact or outcome node may reach `~query`.

## Query Boundaries And State

- Public query input must use `QueryBoundary` and lower to the shared Query AST. Never create a second query engine for API-facing filters.
- Query boundaries are deny-by-default. Nested relations and collection predicates are never exposed merely because the schema contains them.
- Mutation operations must lower through the shared `MutationPlan`; do not implement immutable updates through Proxy/draft discovery.
- Mutation code delays allocation until a semantic change is known whenever possible.
- Collection mutations reuse shared access-path planning. Do not introduce separate scan/index/binary implementations for queries and mutations.
- Mutation results do not compute patches, inverse patches or changed masks unless requested.
- Derived computations expose or infer their read dependencies. Do not deep-compare an entire state when the computation reads a known subset.
- Changed masks, watch, mutation results and derived computations share a compatible `ChangeLayout`.
- Every public runtime state/query-boundary API has define/AOT parity.
- Every performance claim includes an idiomatic baseline, handwritten optimized ceiling, runtime JIT and AOT measurement.
- A guard that cannot fire is not emitted. Structural limits and semantic budgets are static, so prove a check unreachable before generating it.
- A declared patch is specialized only where the generic deep-partial update would *assign* the leaf. A leaf that update *merges* — object, array, map, set, union — keeps running through it: a patch never changes meaning in order to become faster.
- A collection mutation refuses to write the identity or ordering key. Leaving a collection that still claims a fact which stopped being true is worse than refusing.
- A change mask is meaningful only next to the `ChangeLayout` it was produced against, and is never a persistence format. Report the layout so compatibility can be checked rather than assumed.
- Report a measurement that does not flatter the library as plainly as one that does.

## Runtime Types And DDD Construction

- Runtime types expose one canonical construction boundary. `JIT.class` defaults to direct construction; Value Objects, Entities and Aggregate Roots default to factory construction. Do not expose both `new` and factories by default.
- Create semantics may resolve defaults. Hydrate semantics never regenerate persisted defaults.
- Nested Runtime Types accept their boundary representation and materialize recursively through the shared validation/materialization lowering.
- Scalar Value Objects are runtime objects with a readonly `value` accessor; never represent them as primitive intersections with methods.
- `Typeof` describes that materialized runtime representation. `Input`, `Hydrate`, and `Wire` describe boundary representations; never make `Typeof` primitive merely because a scalar Value Object serializes as one.
- Identity inference uses identifier metadata only when exactly one unambiguous candidate exists. Explicit identity always wins.
- Identifier metadata marks a Value Object as an identity candidate; it does not give the Value Object `identity()`/`sameIdentity()`. Those methods belong to Entities and Aggregate Roots.
- Factory validation and domain assertions are opt-in and add zero work to unconfigured classes. `.validate()` selects the failure channel and the phases it covers; it does not decide whether the schema is checked, because defaults and nested Runtime Type materialization come from that same parse.
- A domain assertion reports through the factory's result policy, never its own. An assertion error carries the rule and the field, never the rejected value.
- Result policy is fixed at artifact declaration and reflected exactly in factory types.
- Boolean validation is fail-fast and constructs no issue. Diagnostic validation collects every independent failure, and a failed prerequisite type check suppresses the checks that depended on it.
- `parse()` and `safeParse()` share one diagnostic emitter and report the same issues; factory validation reuses the same ValidationPlan rather than a class- or DDD-specific validator.
- Every validation operator that can fail declares a stable issue code, a default message and a way to override that message. The diagnostics matrix test is the gate: a new failing operator that skips it breaks the build.
- A custom message never changes an issue code and never reaches boolean codegen. Application logic depends on `issue.code`/`issue.params`, never on `issue.message`, and no issue carries the rejected value.
- Class capabilities reuse existing compiler plans; do not create separate clone, validation or diff engines for classes.
- Class and DDD capabilities attach through `.extends()`; do not reintroduce `.use()` for prototype capabilities.
- Timestamp, soft-delete, and version capabilities live under `JIT.ddd` and attach through `.extends()`. Their default clocks remain directly emitted; custom clocks are runtime bindings and require an explicit AOT skip reason.
- Custom extensions live on the prototype and never allocate a method per instance, and there is no dispatcher between a call and its body.
- An extension name may not shadow a schema accessor, a factory, the constructor or an installed capability. There is no override escape hatch.
- Built-in extensions are reconstructive AOT capabilities. Application methods are runtime bindings and make standalone AOT generation skip the complete class with a reason. Never reconstruct a custom method from `Function#toString`; a future portable method requires declarative IR or an explicit external-module binding contract.
- State collection mutation reuses access-path planning and the element `MutationPlan`.
- Filtering, mapping and grouping remain CQRS concerns rather than state collection mutations.

## Feature Documentation

Every public feature must add or update its `docs/features/*` document in the
same change. A complete feature document covers:

- problem and why schema specialization belongs in JIT;
- canonical API and exact semantics;
- compiler, generated-code and physical-strategy design;
- allocations, materialization and algorithmic complexity;
- runtime, define and AOT behavior;
- reproducible benchmark methodology and measured results;
- tradeoffs, best practices and explicit non-goals.

Do not publish a performance claim without a reproducible benchmark. Hot
operation benchmarks compare idiomatic JavaScript, a handwritten optimized
ceiling, runtime JIT and AOT, and include allocation or memory measurements
where relevant.

## Current Evolution Goal

JIT is a compiler of specialized data operations. The current evolution work
consolidates query under `JIT.cqrs`, introduces semantic-to-physical planning,
and builds reusable ordering, indexing, projection, reconciliation,
authorization and transport plans. High-level abstractions must disappear from
AOT output: no schema walker, query interpreter, permission rule walker,
runtime compiler, or unrelated high-level dependency may remain.
