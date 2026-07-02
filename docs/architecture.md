# JIT Project Master Context and Engineering Contract

You are working inside the monorepo for **JIT**, a TypeScript library focused on specialization through runtime code generation.

This document is the authoritative architectural and engineering context for the project. Read it completely before changing files.

Status note: the legacy `DSL` and `ATS` directories described below have now been migrated into the namespace-based `JIT` factories/core under `src/factories` and `src/core/ats`, then removed from source. Treat remaining `DSL` and legacy `ATS` references in this document as historical migration context, not as active source layout.

Begin this work in planning mode.

Do not immediately rewrite the repository. First inspect the real implementation, understand the legacy architecture, identify compatibility requirements, and produce a staged migration plan.

---

# 1. Project identity

The project is called **JIT**.

Repository:

```text
https://github.com/pedro5g/jit.git
```

JIT is not intended to be only another schema validator.

Its core purpose is:

> Describe a data structure once and generate highly specialized, predictable, high-quality JavaScript code for operations over that structure.

JIT must behave like a runtime compiler for JavaScript and TypeScript data structures.

The schema construction API describes the data. Compilers use that description to generate dedicated functions for specific operations.

Potential compilation targets include:

- validation;
- parsing;
- deep equality;
- cloning;
- hashing;
- diffing;
- patching;
- serialization;
- deserialization;
- matching;
- comparison;
- sorting;
- selectors;
- getters;
- setters;
- collection indexing;
- DTO operations;
- immutable update operations.

The project must prioritize generated functions that are:

- specialized;
- predictable;
- readable when inspected;
- safe;
- deterministic;
- highly optimized;
- free of unnecessary runtime interpretation;
- suitable for JavaScript engine optimization.

The desired execution model is:

```text
Schema construction
        ↓
AST transformations
        ↓
Compilation
        ↓
Specialized JavaScript function
        ↓
Repeated high-performance execution
```

The schema and compilation paths may perform setup work when justified. The generated execution path must contain as little generic work as possible.

---

# 2. Primary engineering objective

The primary objective of JIT is to be as fast as reasonably possible while remaining correct, maintainable, strongly typed, and safe.

Performance must not mean producing unreadable arbitrary code.

JIT should generate **high-level JavaScript that is predictable and engine-friendly**.

For example, a compiled equality operation for a known object should resemble:

```ts
function equalUser(left, right) {
  if (left === right) return true;

  return left.id === right.id && left.name === right.name;
}
```

It should not interpret a schema tree on every invocation:

```ts
function equal(left, right, schema) {
  for (const key of Object.keys(schema.def.props)) {
    // Generic runtime dispatch.
  }
}
```

Generic schema traversal belongs in the compilation path, not in the compiled hot path.

Performance decisions must follow these principles:

1. Avoid work.
2. Specialize whenever the schema provides enough information.
3. Preserve stable object shapes.
4. Avoid unnecessary allocation.
5. Avoid unnecessary indirection.
6. Avoid generic callbacks in hot loops.
7. Prefer direct property access when properties are known.
8. Prefer predictable loops over abstraction-heavy iteration in hot paths.
9. Use appropriate data structures for the operation.
10. Benchmark assumptions before accepting complexity.
11. Distinguish compile-time cost from execution-time cost.
12. Optimize generated code before micro-optimizing schema construction.

---

# 3. Mandatory first steps

Before modifying code:

1. Inspect the repository root.
2. Read the root `package.json`.
3. Read the workspace configuration.
4. Read the package-level `package.json` files.
5. Read all relevant `tsconfig` files.
6. Read the Biome configuration.
7. Read the Vitest configuration.
8. Read the build configuration used by `zshy`.
9. Inspect package exports.
10. Inspect path aliases and custom conditions such as `@jit/source`.
11. Inspect all existing tests and benchmarks.
12. Inspect the legacy directories:

    - `ATS`;
    - `DSL`;
    - `equal`;
    - `shared`.

13. Identify every public export from those directories.
14. Identify every internal consumer.
15. Identify circular dependencies.
16. Identify runtime and type-level compatibility constraints.
17. Produce an architecture map before implementation.

Do not assume that directory names, files, or APIs exactly match this document. Compare this target architecture against the actual repository.

Do not delete legacy code during the initial migration.

---

# 4. Monorepo environment

The root package currently follows this configuration:

```json
{
  "type": "module",
  "private": false,
  "packageManager": "pnpm@11.8.0",
  "repository": {
    "type": "git",
    "url": "git+https://github.com/pedro5g/jit.git"
  },
  "scripts": {
    "fix": "pnpm run format && pnpm run lint",
    "format": "biome check --write .",
    "format:check": "biome check .",
    "lint": "biome lint --write .",
    "lint:check": "biome lint .",
    "clean": "pnpm run -r clean",
    "build": "pnpm run -r --filter jit build",
    "test:watch": "vitest",
    "test": "vitest run",
    "prepublishOnly": "pnpm run test && pnpm run build",
    "dev": "tsx --conditions @jit/source",
    "dev:watch": "tsx --conditions @jit/source --watch",
    "prepare": "husky",
    "check:semver": "tsx scripts/check-semver.ts"
  }
}
```

Relevant tooling includes:

```text
pnpm 11.8.0
TypeScript 6.0.x
Vitest 4.1.x
Biome 2.5.x
zshy
tsx
Husky
Commitlint
lint-staged
```

Use `pnpm`.

Do not use `npm`, `yarn`, or `bun` unless explicitly requested.

Use the repository’s real commands.

Required verification commands normally include:

```bash
pnpm format:check
pnpm lint:check
pnpm test
pnpm build
```

`pnpm fix`, `pnpm format`, and `pnpm lint` modify files. Use them deliberately and inspect their resulting diff.

Do not invent a `typecheck` command if none exists. Determine whether type checking is covered by the package build. If a dedicated type-check operation is needed, inspect the actual package configuration and use an appropriate existing command or a carefully scoped `pnpm exec tsc --noEmit -p ...`.

Do not modify dependency versions without a concrete requirement.

Do not add production dependencies without explaining why the existing code and platform APIs are insufficient.

---

# 5. ESM and import conventions

The project is ESM.

TypeScript source imports must use emitted JavaScript extensions when that is the existing convention:

```ts
import type { TypeSchema } from "./type-schema.js";
import { TypeName } from "./type-name.js";
```

Do not silently replace `.js` import specifiers with extensionless imports.

Use:

```ts
import type { ... } from "...";
```

for type-only dependencies.

This is important for:

- emitted ESM correctness;
- tree shaking;
- avoiding unnecessary runtime imports;
- preventing cycles caused only by types.

---

# 6. Namespace-oriented module pattern

The existing project uses namespace exports to group related operations.

This pattern must be preserved and intentionally incorporated into the new architecture.

Example:

```ts
export * as Equal from "./equals.js";
export * as Parse from "./parse.js";
export * from "./types.js";
export * as Utils from "./utils.js";

export type Equal<T = unknown> = import("./types.js").Equal<T>;
```

This creates two useful API layers:

1. A namespace-like runtime export:

```ts
Equal.array(...)
Parse.join_path(...)
Utils.Object_is(...)
```

2. A directly exported type alias:

```ts
const equals: Equal<User> = ...
```

The runtime namespace and type alias may have the same public name because TypeScript maintains separate value and type namespaces.

Preserve this capability where it improves navigation and semantic grouping.

## 6.1 Intended namespace groups

The new architecture may expose groups similar to:

```ts
export * as AST from "./core/ast/index.js";
export * as Types from "./core/types/index.js";
export * as Transform from "./transforms/index.js";
export * as Equal from "./compilers/equal/index.js";
export * as Parse from "./compiler/parse/index.js";
export * as Utils from "./internal/utils/index.js";
```

The exact public names must be determined by compatibility requirements and the actual repository.

The old `ATS` name may temporarily remain as a compatibility namespace:

```ts
export * as ATS from "./core/ast/index.js";
```

However, the canonical directory should be named `ast`, not `ats`.

If `ATS` is already part of the public API:

- preserve it during migration;
- document it as a compatibility namespace if it will eventually be replaced;
- do not break existing imports without an explicit versioning decision.

## 6.2 Internal namespace imports

Code may intentionally use namespace imports when they provide clear ownership:

```ts
import * as AST from "../../core/ast/index.js";
import * as Parse from "../../compiler/parse/index.js";
import * as Utils from "../../internal/utils/index.js";
```

This allows signatures such as:

```ts
export function extend<
  TSchema extends AST.AnyObjectSchema,
  TProps extends AST.SchemaShape,
>(
  schema: TSchema,
  props: TProps,
): AST.ObjectSchema<AST.ExtendShape<TSchema["def"]["props"], TProps>> {
  // ...
}
```

The namespace style is useful because it:

- communicates module ownership;
- avoids collisions between generic names;
- improves autocomplete discoverability;
- groups related low-level primitives;
- makes compiler code easier to scan.

Do not force namespace imports everywhere.

Use direct imports when:

- a module uses only one or two symbols;
- namespace importing would pull a runtime module for types;
- it creates circular dependencies;
- the direct dependency is clearer;
- tree-shaking output is materially better.

Use namespace imports intentionally, not mechanically.

## 6.3 Namespace barrel constraints

Namespace barrels must not become dependency-cycle hubs.

Rules:

- package root `index.ts` files are re-export only; they must not contain runtime logic, helper functions, initialization, or implementation details;
- use `export type` for types;
- avoid top-level initialization in barrels;
- avoid importing a package root from inside the same package;
- internal modules should not import from the global public root;
- use domain-local barrels only at stable boundaries;
- do not route every internal import through one enormous `index.ts`;
- inspect emitted bundles and cycles.

---

# 7. Callable functions with attached operations

The project uses functions as both callable values and namespaces for related specialized operations.

This pattern must be retained.

Legacy example:

```ts
function array<T>(deepEqualFn: Equal<T>): Equal<readonly T[]> {
  return (left, right) => {
    if (Utils.Object_is(left, right)) return true;

    const length = left.length;

    if (length !== right.length) return false;

    for (let index = length; index-- !== 0; ) {
      if (!deepEqualFn(left[index], right[index])) return false;
    }

    return true;
  };
}

array.writable = function arrayEquals(builder: Builder): Builder & {
  type: "array";
} {
  // Specialized generated-code builder.
};
```

Usage:

```ts
const arrayEqual = Equal.array(Equal.string);
const writableArrayBuilder = Equal.array.writable(itemBuilder);
```

This is a deliberate pattern.

It provides:

- a compact API;
- related functionality under one semantic symbol;
- direct invocation for runtime helpers;
- attached specialized compilation variants;
- strong discoverability through autocomplete;
- no class instance requirement.

## 7.1 New implementation requirements

Preserve the pattern, but type it explicitly.

Prefer a callable interface:

```ts
export interface ArrayEqualOperator {
  <TValue>(equal: Equal<TValue>): Equal<readonly TValue[]>;

  readonly writable: (builder: EqualBuilder) => TypedEqualBuilder<"array">;

  readonly readonly: (builder: EqualBuilder) => TypedEqualBuilder<"array">;
}
```

Then implement it with a named function and stable attached members.

A valid implementation approach is:

```ts
function createArrayEqual<TValue>(
  equal: Equal<TValue>,
): Equal<readonly TValue[]> {
  return function arrayEqual(left, right) {
    if (Utils.Object_is(left, right)) return true;

    const length = left.length;

    if (length !== right.length) return false;

    for (let index = length; index-- !== 0; ) {
      if (!equal(left[index], right[index])) return false;
    }

    return true;
  };
}

function createWritableArrayBuilder(
  builder: EqualBuilder,
): TypedEqualBuilder<"array"> {
  // ...
}

export const array: ArrayEqualOperator = /* @__PURE__ */ Object.assign(
  createArrayEqual,
  {
    writable: createWritableArrayBuilder,
    readonly: createReadonlyArrayBuilder,
  },
);
```

Direct property assignment is also acceptable if it produces better output with the current toolchain:

```ts
export const array = createArrayEqual as ArrayEqualOperator;
array.writable = createWritableArrayBuilder;
array.readonly = createReadonlyArrayBuilder;
```

Compare emitted output and tree shaking before standardizing one form.

## 7.2 `@__PURE__` and callable namespaces

`/* @__PURE__ */` may be placed before a side-effect-free factory call such as `Object.assign` when removing the entire result is semantically safe.

Example:

```ts
export const array = /* @__PURE__ */ Object.assign(createArrayEqual, {
  writable: createWritableArrayBuilder,
});
```

Do not add `@__PURE__` to arbitrary expressions.

A pure annotation is only correct when:

- evaluating the call has no required side effect;
- dropping the result is safe;
- all attached functions are declarations or stable references;
- the bundler and minifier recognize the annotation.

Add a tree-shaking fixture or bundle test before relying on the annotation.

## 7.3 Function properties as static capabilities

Attached properties should represent meaningful static capabilities:

```ts
Equal.array.writable;
Equal.array.readonly;
Equal.array.compile;
Equal.array.unordered;
```

Do not turn every function into a random property container.

A property belongs on a callable function when it is:

- semantically subordinate to that function;
- a specialized mode of the same operation;
- useful for API discoverability;
- stable enough to be public.

---

# 8. Runtime equal pattern

The existing equality implementation demonstrates a pattern that should remain available:

```ts
function array<TValue>(equal: Equal<TValue>): Equal<readonly TValue[]> {
  return function arrayEqual(left, right) {
    if (Utils.Object_is(left, right)) return true;

    const length = left.length;

    if (length !== right.length) return false;

    for (let index = length; index-- !== 0; ) {
      if (!equal(left[index], right[index])) return false;
    }

    return true;
  };
}
```

Important characteristics:

1. Fast reference equality exit.
2. Length read once.
3. Length comparison before traversal.
4. Indexed loop.
5. No temporary arrays.
6. No `every`, `map`, `reduce`, or callback allocation inside the loop.
7. Immediate failure.
8. Reusable specialized child equality function.
9. Named returned function when useful for profiling and stack traces.

Do not blindly force reverse loops everywhere.

A reverse loop is appropriate when:

- iteration order has no semantic effect;
- it benchmarks well;
- it simplifies the loop condition;
- failure location does not affect diagnostics.

Use forward loops when:

- source order matters;
- error reporting must return the first path;
- cache locality or generated source favors forward traversal;
- it is clearer and no slower in the measured environment.

---

# 9. Generated equality builder pattern

The legacy generated-code builder follows this conceptual form:

```ts
array.writable = function arrayEquals(child: Builder): Builder & {
  type: "array";
} {
  function continueArrayEquals(leftPath: Path, rightPath: Path, scope: Scope) {
    const left = Parse.join_path(leftPath, scope.isOptional);

    const right = Parse.join_path(rightPath, scope.isOptional);

    const leftItemIdentifier = `${Parse.ident(left, scope.bindings)}_item`;

    const rightItemIdentifier = `${Parse.ident(right, scope.bindings)}_item`;

    const lengthIdentifier = Parse.ident("length", scope.bindings);

    const access = scope.isOptional ? "?." : ".";

    return [
      `const ${lengthIdentifier} = ${left}${access}length;`,
      `if (${lengthIdentifier} !== ${right}${access}length) return false;`,
      `for (let index = ${lengthIdentifier}; index-- !== 0;) {`,
      `const ${leftItemIdentifier} = ${left}[index];`,
      `const ${rightItemIdentifier} = ${right}[index];`,
      child([leftItemIdentifier], [rightItemIdentifier], scope),
      `}`,
    ].join("\n");
  }

  continueArrayEquals.type = "array" as const;

  return continueArrayEquals;
};
```

This pattern contains several architectural ideas that must survive the migration:

- code generation is compositional;
- child builders emit code for child schemas;
- paths are represented separately from rendered JavaScript;
- identifiers are centrally allocated;
- bindings prevent name collisions;
- optional access is controlled by compile context;
- generated code uses direct indexed access;
- generated source remains understandable;
- builders may carry discriminating metadata such as `.type`.

The new compiler architecture may replace raw string arrays with a `CodeWriter`, structured expression helpers, or an emitter context.

However, preserve these principles:

```text
typed builder
+ compiler context
+ deterministic identifiers
+ direct generated code
+ compositional child emission
```

Do not replace this with a generic runtime visitor.

---

# 10. Utility intrinsics pattern

The existing project accesses selected native functions through a namespace:

```ts
Utils.Object_is(left, right);
Utils.Object_keys(value);
Utils.Object_hasOwn(value, key);
```

Preserve this style where it has measurable or architectural value.

Potential intrinsic module:

```text
src/internal/intrinsics/
├── object.ts
├── array.ts
├── number.ts
├── string.ts
└── index.ts
```

Example:

```ts
export const Object_is = Object.is;
export const Object_keys = Object.keys;
export const Object_hasOwn = Object.hasOwn;
export const Array_isArray = Array.isArray;
export const Number_isNaN = Number.isNaN;
```

Then:

```ts
export * as Utils from "./internal/intrinsics/index.js";
```

Do not cache every global function without justification.

For each intrinsic, consider:

- whether it is used frequently;
- whether local binding improves generated code or minification;
- whether monkey-patching semantics matter;
- whether the engine already optimizes global access;
- bundle cost;
- browser and Node compatibility.

The namespace name may remain `Utils` for compatibility, but internally prefer more specific modules instead of a generic dumping ground.

---

# 11. Legacy architecture

The repository contains legacy implementations under directories conceptually named:

```text
ATS/
DSL/
equal/
shared/
```

These directories are scheduled for eventual removal, but their patterns and behavior must first be understood and migrated.

Do not delete them immediately.

---

# 12. Legacy `ATS`

The old `ATS` area may contain:

- type names;
- schema types;
- schema factories;
- definitions;
- infer helpers;
- schema transformations;
- object operators;
- collection operators;
- old AST contracts.

Expected migration:

```text
ATS type names       → src/core/ast/type-name.ts
ATS definitions      → src/core/ast/definitions
ATS schema contracts → src/core/ast/schemas
ATS inference        → src/core/ast/infer.ts and src/core/types
ATS transforms       → src/transforms
ATS factories        → src/factories
ATS public namespace → compatibility re-export if required
```

The semantic namespace style may remain:

```ts
import * as ATS from "../core/ast/index.js";
```

or:

```ts
export * as ATS from "./core/ast/index.js";
```

The physical directory should eventually be `ast`.

---

# 13. Legacy `DSL`

The old `DSL` area may contain:

- code builders;
- paths;
- parser utilities;
- string emission;
- identifier generation;
- scope objects;
- bindings;
- fluent operations;
- generated-source fragments.

Expected migration:

```text
DSL path utilities       → src/compiler/source or src/compiler/path
DSL identifier utilities → src/compiler/context
DSL string emitter       → src/compiler/emitter
DSL builders             → compiler-specific builders
DSL fluent schema API    → src/core/builder
DSL transforms           → src/transforms
```

Do not combine the schema builder chain with generated-code builders.

These are different abstractions:

```text
Schema Builder
    Builds and transforms schema AST

Compiler Builder
    Emits specialized operation code
```

Name them distinctly to prevent confusion.

For example:

```text
SchemaBuilder
EqualBuilder
ValidatorEmitter
CloneEmitter
```

Do not use the generic name `Builder` everywhere without a domain qualifier.

---

# 14. Legacy `equal`

The old `equal` implementation is a behavioral and performance reference.

It may contain:

- runtime equality combinators;
- compiled equality builders;
- generated source utilities;
- primitive comparisons;
- collection equality;
- path handling;
- optional handling;
- specialized object equality.

Expected migration:

```text
equal public compiler      → src/compilers/equal
equal generated emitters   → src/compilers/equal/emitter
equal runtime fallbacks    → src/runtime/equal
equal shared compiler code → src/compiler
equal tests                → colocated new __tests__
```

During migration:

1. Preserve legacy tests.
2. Add compatibility tests between old and new implementations.
3. Preserve public exports until a versioned breaking change.
4. Benchmark old and new versions.
5. Inspect generated code snapshots.
6. Confirm semantic parity for edge cases.
7. Remove the old implementation only after equivalence is proven.

---

# 15. Legacy `shared`

The old `shared` directory must be decomposed by responsibility.

Do not replace it with another unlimited `shared` directory.

Expected mapping:

```text
shared type utilities
→ src/core/types

shared schema guards
→ src/core/ast/guards.ts

shared native references
→ src/internal/intrinsics

shared parse utilities
→ src/compiler/source or src/compiler/parse

shared code writer utilities
→ src/compiler/emitter

shared errors
→ src/internal/errors

shared assertions
→ src/internal/assertions

shared symbols
→ src/internal/symbols

shared runtime equality helpers
→ src/runtime/equal

shared compiler cache
→ src/compiler/cache
```

A helper should live with the subsystem that owns its semantics.

Do not extract a generic helper until:

- at least two real consumers exist;
- the semantics are identical;
- extraction does not damage inlining or tree shaking;
- the abstraction has a stable name.

---

# 16. Target directory architecture

Use the following architecture as the target, adapting it to the real repository:

```text
src/
├── core/
│   ├── ast/
│   │   ├── base-schema.ts
│   │   ├── type-name.ts
│   │   ├── type-schema.ts
│   │   ├── annotations.ts
│   │   ├── infer.ts
│   │   ├── guards.ts
│   │   ├── index.ts
│   │   │
│   │   ├── definitions/
│   │   │   ├── common/
│   │   │   ├── checks/
│   │   │   ├── primitive/
│   │   │   ├── collection/
│   │   │   ├── composition/
│   │   │   ├── special/
│   │   │   └── index.ts
│   │   │
│   │   └── schemas/
│   │       ├── primitive/
│   │       ├── collection/
│   │       ├── composition/
│   │       ├── special/
│   │       └── index.ts
│   │
│   ├── builder/
│   │   ├── builder.ts
│   │   ├── builder-core.ts
│   │   ├── builder-specialization.ts
│   │   ├── create-builder.ts
│   │   ├── unwrap-schema.ts
│   │   ├── prototypes/
│   │   ├── operators/
│   │   │   ├── shared/
│   │   │   ├── primitive/
│   │   │   ├── collection/
│   │   │   ├── object/
│   │   │   └── index.ts
│   │   └── index.ts
│   │
│   ├── hints/
│   │   ├── shared.ts
│   │   ├── compile-hints.ts
│   │   ├── collection-hint.ts
│   │   ├── entity-hint.ts
│   │   ├── order-hint.ts
│   │   ├── compare-hint.ts
│   │   ├── hash-hint.ts
│   │   ├── clone-hint.ts
│   │   ├── diff-hint.ts
│   │   ├── serialize-hint.ts
│   │   ├── metadata.ts
│   │   └── index.ts
│   │
│   └── types/
│       ├── schema-like.ts
│       ├── infer.ts
│       ├── optional.ts
│       ├── nullable.ts
│       ├── readonly.ts
│       ├── partial.ts
│       ├── deep-partial.ts
│       ├── required.ts
│       ├── deep-required.ts
│       ├── deep-readonly.ts
│       ├── pick.ts
│       ├── omit.ts
│       ├── merge.ts
│       ├── extend.ts
│       ├── brand.ts
│       └── index.ts
│
├── factories/
│   ├── primitive/
│   ├── collection/
│   ├── composition/
│   ├── special/
│   ├── jit.ts
│   └── index.ts
│
├── transforms/
│   ├── object/
│   ├── wrappers/
│   ├── annotations/
│   ├── collection/
│   └── index.ts
│
├── compiler/
│   ├── context/
│   ├── emitter/
│   ├── source/
│   ├── path/
│   ├── cache/
│   ├── visitor/
│   └── index.ts
│
├── compilers/
│   ├── validator/
│   ├── equal/
│   ├── clone/
│   ├── hash/
│   ├── diff/
│   ├── patch/
│   ├── serializer/
│   ├── parser/
│   ├── matcher/
│   └── index.ts
│
├── dto/
│   ├── methods/
│   ├── entity/
│   ├── selectors/
│   ├── compile-dto.ts
│   └── index.ts
│
├── runtime/
│   ├── equal/
│   ├── hash/
│   ├── clone/
│   ├── serializer/
│   └── index.ts
│
├── internal/
│   ├── intrinsics/
│   ├── errors/
│   ├── assertions/
│   ├── symbols/
│   └── index.ts
│
└── index.ts
```

Use lowercase directory names and kebab-case files unless the existing repository has a deliberate conflicting convention that must temporarily remain for compatibility.

---

# 17. Base schema runtime shape

The schema AST must have a small, stable, predictable runtime shape.

The existing `_type` pattern must be maintained unless a future breaking change explicitly replaces it.

Use:

```ts
interface BaseSchema<TOutput, TType extends AnyTypeName, TDefinition> {
  readonly type: TType;
  readonly _type: TOutput;
  readonly def: Readonly<TDefinition>;
  readonly annotations: SchemaAnnotations<TOutput> | undefined;
}
```

At runtime, `_type` should remain a sentinel:

```ts
{
  type: TypeName.string,
  _type: null,
  def: stringDefinition,
  annotations: undefined,
}
```

The compile-time type of `_type` remains the inferred output type even though its runtime value is `null`.

This requires a localized assertion inside schema factories.

Example:

```ts
const output = null as unknown as string;
```

Do not scatter this assertion across the repository.

Centralize schema construction.

Preserve property order across all schema factories:

```text
type
_type
def
annotations
```

Do not sometimes omit `annotations` and sometimes include it unless benchmarks show that variable shapes are preferable.

Prefer a single stable schema shape.

Tests must verify:

```ts
expect(schema._type).toBeNull();
expectTypeOf(schema._type).toEqualTypeOf<string>();
```

This is an intentional compatibility and typing pattern.

---

# 18. Schema definitions

Every schema stores its payload inside `def`.

Examples:

```ts
{
  type: TypeName.array,
  _type: null,
  def: {
    element,
    checks,
  },
  annotations: undefined,
}
```

```ts
{
  type: TypeName.object,
  _type: null,
  def: {
    props,
    unknownKeys,
    checks,
  },
  annotations: undefined,
}
```

Canonical definition names:

```text
innerType
element
key
value
items
rest
options
left
right
props
getter
ctor
predicate
transform
coercer
pipeline
defaultValue
brand
checks
```

Do not restore legacy names such as:

```text
item
schemas
literalValue
enumObject
brandName
```

unless needed in a temporary compatibility adapter.

---

# 19. Strong typing requirements

Avoid `any`.

Use `unknown`, precise generics, conditional types, mapped types, and discriminated unions.

Legacy public types may still contain `any`:

```ts
export type Equal<T = any> = ...
```

Do not silently break them during migration.

For new internal types, prefer:

```ts
export type Equal<T = unknown> = (left: T, right: T) => boolean;
```

If compatibility requires the old default:

```ts
export type Equal<T = any> = import("./types.js").Equal<T>;
```

keep the public alias temporarily but make internal contracts stricter.

Every use of `any` added during migration must be one of:

- a deliberate compatibility boundary;
- an unavoidable external library boundary;
- an isolated implementation signature hidden behind a precise public type.

Document such cases.

Do not return:

```ts
Builder<any>;
TypeSchema<any>;
```

when a precise type can be derived.

Use `const` type parameters to preserve literals and tuples where useful.

---

# 20. JIT API

The public API should support both the namespace object and named imports.

Namespace usage:

```ts
const User = JIT.object({
  id: JIT.number(),
  name: JIT.string(),
})
  .partial()
  .required()
  .readonly();
```

Named usage:

```ts
import { object, number, string } from "jit";

const User = object({
  id: number(),
  name: string(),
});
```

The `JIT` object should expose schema factories and compilers.

Conceptual API:

```ts
JIT.string();
JIT.number();
JIT.int();
JIT.nan();
JIT.boolean();
JIT.bigint();
JIT.symbol();
JIT.date();
JIT.regex();
JIT.file();
JIT.null();
JIT.undefined();
JIT.any();
JIT.unknown();
JIT.never();
JIT.void();

JIT.object(shape);
JIT.array(element);
JIT.set(element);
JIT.map(key, value);
JIT.record(key, value);
JIT.tuple(items, rest);

JIT.union(options);
JIT.discriminatedUnion(discriminator, options);
JIT.intersection(left, right);

JIT.optional(schema);
JIT.nullable(schema);
JIT.readonly(schema);
JIT.promise(schema);
JIT.lazy(getter);

JIT.literal(value);
JIT.enum(values);
JIT.instanceOf(ctor);

JIT.default(schema, value);
JIT.brand(schema, name);
JIT.refine(schema, predicate);
JIT.transform(schema, transform);
JIT.coerce(schema, coercer);
JIT.pipe(...schemas);

JIT.compileValidator(schema);
JIT.compileEqual(schema);
JIT.compileClone(schema);
JIT.compileHash(schema);
JIT.compileDiff(schema);
JIT.compilePatch(schema);
JIT.compileSerializer(schema);
JIT.compileParser(schema);
JIT.compileMatcher(schema);
JIT.compileDTO(schema);
```

The compiler methods may be introduced incrementally.

Do not add placeholder public functions that throw unless explicitly required for API staging.

---

# 21. Builder chain

The AST must remain separate from the fluent builder.

A schema builder contains:

```ts
interface BuilderCore<TSchema extends AST.AnySchema> {
  readonly schema: TSchema;
}
```

The final builder type should be composed:

```ts
type Builder<TSchema extends AST.AnySchema> = BuilderCore<TSchema> &
  BaseOperators<TSchema> &
  BuilderSpecialization<TSchema>;
```

The builder must not use `Proxy`.

Methods should be shared through prototypes, classes, or another allocation-efficient mechanism.

Do not create a fresh closure for every method on every builder instance.

The builder should ideally contain only:

```ts
{
  schema;
}
```

Specialized prototypes may be used:

```text
baseBuilderPrototype
stringBuilderPrototype
numberBuilderPrototype
objectBuilderPrototype
arrayBuilderPrototype
```

Evaluate class prototypes and `Object.create` based on emitted code and benchmarks rather than ideology.

---

# 22. Operators and transformations

Operators are divided into two layers:

```text
Type-level transformation
Runtime AST transformation
```

Example:

```ts
schema.partial();
```

Type-level result:

```ts
Builder<ObjectSchema<PartialShape<TProps>>>;
```

Runtime result:

```text
ObjectSchema with each property wrapped in OptionalSchema
```

`partial`, `required`, `pick`, `omit`, `extend`, and `merge` must not become new AST node types.

They must return transformed existing schemas.

Example public signature:

```ts
interface ObjectOperators<TProps extends AST.SchemaShape> {
  partial(): Builder<AST.ObjectSchema<Types.PartialShape<TProps>>>;

  required(): Builder<AST.ObjectSchema<Types.RequiredShape<TProps>>>;

  pick<const TKeys extends readonly (keyof TProps)[]>(
    keys: TKeys,
  ): Builder<AST.ObjectSchema<Types.PickShape<TProps, TKeys[number]>>>;
}
```

Runtime implementation delegates:

```ts
function partial(this: RuntimeObjectBuilder): RuntimeBuilder {
  return createBuilder(Transform.partialObject(this.schema));
}
```

---

# 23. Equality namespaces

The equality subsystem should preserve namespace-oriented composition.

Potential public API:

```ts
Equal.string;
Equal.number;
Equal.boolean;

Equal.array(childEqual);
Equal.array.writable(childBuilder);

Equal.object(shape);
Equal.object.writable(shapeBuilder);

Equal.optional(child);
Equal.nullable(child);

Equal.compile(schema);
```

Runtime equality helpers and compiled equality builders may coexist.

Keep their names explicit:

```text
Equal<T>
EqualBuilder
CompiledEqual<T>
```

Do not overload one generic `Builder` name across unrelated systems.

---

# 24. Parser and source namespaces

The old `Parse` namespace may contain operations such as:

```ts
Parse.ident(...)
Parse.join_path(...)
Parse.stringify_key(...)
Parse.stringify_literal(...)
```

Preserve semantic grouping, but reorganize implementation into owned compiler modules.

Potential structure:

```text
src/compiler/
├── source/
│   ├── identifier.ts
│   ├── literal.ts
│   ├── property-access.ts
│   └── index.ts
├── path/
│   ├── path.ts
│   ├── join-path.ts
│   └── index.ts
└── context/
    ├── bindings.ts
    ├── scope.ts
    └── index.ts
```

Compatibility barrel:

```ts
export * as Parse from "./compiler/source/index.js";
```

If `Parse` contains both source and path functions, create a deliberate public barrel rather than putting unrelated files back into one implementation module.

---

# 25. Test organization

Unit tests must be colocated under `__tests__` directories.

Examples:

```text
src/core/ast/schemas/primitive/__tests__/
  primitive-schema.test.ts

src/core/builder/__tests__/
  object-chain.test.ts

src/transforms/object/__tests__/
  partial-object.test.ts

src/compilers/equal/__tests__/
  array-equal.test.ts
```

Use Vitest.

Preserve the existing test style:

```ts
describe("DSL AST builders", () => {
  describe("primitives", () => {
    it("should correctly generate the string schema", () => {
      const schema = T.string();

      expect(schema.type).toBe(ATS.TypeName.string);
      expect(schema._type).toBeNull();

      expectTypeOf(schema._type).toEqualTypeOf<string>();
    });

    it("should correctly generate number variants", () => {
      expect(T.number().type).toBe(ATS.TypeName.number);

      expectTypeOf(T.number()._type).toBeNumber();

      expect(T.int().type).toBe(ATS.TypeName.int);

      expectTypeOf(T.int()._type).toBeNumber();

      expect(T.bigInt().type).toBe(ATS.TypeName.bigint);

      expectTypeOf(T.bigInt()._type).toBeBigInt();

      expect(T.nan().type).toBe(ATS.TypeName.nan);

      expectTypeOf(T.nan()._type).toBeNumber();
    });
  });
});
```

Before preserving names such as `bitInt`, determine whether they are intentional public API or an old typo for `bigInt`.

Do not silently rename a public function without migration consideration.

## 25.1 Test grouping

Use nested `describe` blocks to communicate:

```text
subsystem
→ feature group
→ expected behavior
```

Example:

```ts
describe("Object builder operators", () => {
  describe("partial", () => {
    it("wraps direct properties in optional schemas", () => {
      // ...
    });

    it("preserves property order", () => {
      // ...
    });
  });
});
```

## 25.2 Runtime and type assertions

Whenever an API has meaningful inference, test both runtime output and compile-time output.

Example:

```ts
const User = T.object({
  id: T.number(),
  name: T.string(),
}).partial();

expect(User.schema.type).toBe(ATS.TypeName.object);

expectTypeOf<ATS.Infer<typeof User>>().toEqualTypeOf<{
  id?: number;
  name?: string;
}>();
```

Use `// @ts-expect-error` for invalid APIs:

```ts
// @ts-expect-error string schemas do not expose pick()
T.string().pick(["value"]);
```

Do not use `@ts-ignore`.

## 25.3 Regression tests

During migration, create tests that execute both old and new implementations against the same cases.

Example:

```ts
expect(newEqual(left, right)).toBe(legacyEqual(left, right));
```

Cover:

- primitives;
- arrays;
- sparse arrays;
- objects;
- optional fields;
- nullable values;
- dates;
- regular expressions;
- maps;
- sets;
- unions;
- recursive schemas;
- reference equality;
- `NaN`;
- signed zero where relevant.

---

# 26. Generated-source tests

Compilers must include source snapshot or exact-source tests where appropriate.

Generated code must be deterministic.

Example:

```ts
expect(compiled.source).toMatchInlineSnapshot(`
  "function equal(left, right) {
    if (left === right) return true;
    return left.id === right.id;
  }"
`);
```

Do not make snapshots depend on random identifiers.

Identifier generation must be deterministic for a given schema and compiler configuration.

Also test generated functions behaviorally. A source snapshot alone is insufficient.

---

# 27. Performance rules

Follow these performance rules throughout the project.

## 27.1 Avoid work

Before making an operation faster, determine whether the operation can be removed.

Use:

- compilation caches;
- lazy compilation;
- schema normalization caching;
- reused static definitions;
- incremental work where applicable;
- early exits.

Use `WeakMap` for identity-based schema caches when appropriate.

Do not repeatedly normalize or traverse the same immutable schema.

## 27.2 Preserve shapes

Create equivalent objects with properties in the same order.

Schema factories should consistently create:

```ts
{
  type,
  _type,
  def,
  annotations,
}
```

Definitions of the same kind should also preserve a stable shape.

Avoid:

```ts
const definition = {
  element,
};

if (checks !== undefined) {
  definition.checks = checks;
}
```

Prefer, when benchmark-supported:

```ts
const definition = {
  element,
  checks,
};
```

Avoid deleting properties.

Avoid changing a property between unrelated runtime types.

## 27.3 Avoid allocation in hot paths

Generated execution code should avoid:

- `Array.prototype.map`;
- `Array.prototype.filter`;
- `Array.prototype.reduce`;
- `Array.prototype.every`;
- `Array.prototype.some`;
- `Object.keys`;
- `Object.entries`;
- `Object.values`;
- spread;
- temporary arrays;
- per-iteration closures;
- rest parameter allocation;
- unnecessary intermediate objects.

These operations remain acceptable outside hot paths when they improve clarity and do not affect relevant performance.

## 27.4 Avoid indirection

Generated code should prefer:

```ts
left.profile.name;
```

over generic helpers such as:

```ts
getPath(left, ["profile", "name"]);
```

when the path is known at compile time.

Hoist repeated property access:

```ts
const leftProfile = left.profile;
const rightProfile = right.profile;
```

when this reduces repeated deep access and benchmarks support it.

Do not create a helper call for a single primitive comparison unless reuse, bundle size, or semantics justify it.

## 27.5 Keep generated functions monomorphic when possible

A compiled operation should target one schema and one operation.

Do not make one generated function accept unrelated input modes through changing object shapes.

Keep compilation options resolved before creating the function.

## 27.6 Use direct loops

For arrays:

```ts
for (let index = 0; index < length; index++) {
  // ...
}
```

or:

```ts
for (let index = length; index-- !== 0; ) {
  // ...
}
```

Choose based on semantics and benchmarks.

Read `.length` once when it is stable.

Fail early.

## 27.7 Avoid large generic context objects in hot code

Compiler context objects may be rich during compilation.

Generated runtime functions should receive only required bindings.

Do not pass one giant runtime object containing every intrinsic and helper if a function uses only one or two values.

## 27.8 Specialize collection operations

For a known `Array<User>` schema with identity key `"id"`, generated diff logic may create a keyed index instead of using nested scans.

For known sorted arrays, generated operations may use binary search.

For primitive sets, use native membership where semantics align.

For structural sets, generate explicit strategy code.

Do not apply one generic collection algorithm to every schema.

---

# 28. Code generation safety

Code generation may use `new Function` only in the compilation path.

Never interpolate untrusted runtime values directly into generated source.

Use external bindings for:

- predicates;
- transforms;
- constructors;
- regular expressions;
- custom comparators;
- arbitrary literals that cannot be safely emitted.

Property access rules:

```ts
value.name;
```

only when `name` is a valid safe JavaScript identifier.

Otherwise:

```ts
value["not-a-valid-identifier"];
```

with correctly escaped string literals.

Create centralized and tested functions for:

```text
identifier validation
string escaping
property access
literal emission
binding allocation
```

Do not duplicate escaping logic across compilers.

---

# 29. High-level generated code

Generated code should be high-level JavaScript.

Prefer:

```ts
if (typeof value.name !== "string") {
  return false;
}
```

over deliberately obscure code:

```ts
if ("string" != typeof value.name) return !1;
```

Minifiers can compress production output.

The compiler should prioritize:

- predictable control flow;
- stable statements;
- direct operations;
- debuggability;
- source inspection;
- correct stack traces when debug mode is enabled.

Provide an optional way to inspect generated source.

A future API may expose:

```ts
const compiled = JIT.compileEqual(User, {
  source: true,
});

compiled.fn;
compiled.source;
```

Do not require source retention by default if it increases memory use.

---

# 30. `@__PURE__` and tree shaking

Use pure annotations strategically.

Appropriate examples:

```ts
export const string = /* @__PURE__ */ createPrimitiveFactory(
  TypeName.string,
  emptyStringDefinition,
);
```

```ts
export const array = /* @__PURE__ */ Object.assign(createArrayEqual, {
  writable: createWritableArrayEqualBuilder,
});
```

Do not annotate calls that:

- register global state;
- mutate an externally visible object;
- perform I/O;
- intentionally initialize a cache;
- rely on import-time execution.

Named exports are the primary implementation surface.

The `JIT` namespace is a convenience aggregation:

```ts
export const JIT = {
  string,
  number,
  object,
  array,
  compileEqual,
} as const;
```

Verify whether this aggregation retains all imports in the actual bundler.

If the `JIT` object prevents optimal tree shaking, preserve named exports and consider:

- a separate namespace entry point;
- generated namespace modules;
- documented bundle trade-offs;
- subpath exports.

Do not sacrifice the ergonomic API without measuring the actual output.

---

# 31. Benchmarks

The project must measure:

```text
schema construction
builder construction
operator chaining
compile time
first execution
warmed execution
generated function throughput
memory allocation
bundle output
```

Benchmark realistic cases:

- small flat objects;
- large flat objects;
- nested objects;
- short arrays;
- long arrays;
- optional fields present;
- optional fields absent;
- equality success;
- equality early failure;
- equality late failure;
- unions;
- recursive schemas;
- maps;
- sets.

Compare:

- legacy implementation;
- new implementation;
- native baseline where meaningful;
- generic interpreter;
- specialized generated function.

Do not accept a benchmark that can be optimized away by the engine.

Consume results.

Warm functions appropriately.

Record runtime and engine versions.

Do not make CI depend on fragile absolute timing thresholds.

---

# 32. Builder implementation performance

The builder API is primarily a schema construction path, but it should still be efficient.

Requirements:

- no `Proxy`;
- shared methods;
- stable instance shape;
- no duplicated method closures per instance;
- immutable schema transformations;
- minimal wrapper state;
- predictable specialized prototypes.

The runtime shape may be:

```ts
{
  schema,
}
```

All object builders should share one prototype.

All string builders should share one prototype.

Do not create an object containing every possible operator for every schema.

A string builder must not expose object-only operators at runtime or in its public type.

---

# 33. Error design

Internal invariant failures should use dedicated error classes or helpers.

Examples:

```text
InvalidSchemaError
UnsupportedSchemaError
CompilationError
UnsafeCodeGenerationError
```

Public operator misuse should generally be prevented by TypeScript.

Runtime checks remain necessary because JavaScript consumers can bypass types.

Errors should identify:

- operation;
- schema type;
- path;
- relevant option;
- expected constraint.

Avoid building expensive error strings in a hot success path.

---

# 34. Initial task

The current task is not to implement all of JIT.

The current task is to establish the new typed operator chain foundation.

Proceed in parts.

## Part 1: repository audit

Inspect and report:

- current directories;
- current package boundaries;
- old `ATS`;
- old `DSL`;
- old `equal`;
- old `shared`;
- current public exports;
- existing schema factories;
- existing `_type` behavior;
- current builders;
- current transforms;
- equality compiler;
- tests;
- benchmarks;
- dependency cycles;
- build entry points.

Create a migration table:

```text
legacy file
→ new owner
→ compatibility strategy
→ removal condition
```

Do not modify files before presenting the audit and plan unless a trivial read-only generated artifact is needed.

## Part 2: durable instructions

Create a concise root `AGENTS.md` containing durable rules:

- pnpm commands;
- ESM `.js` imports;
- namespace pattern;
- `_type: null` pattern;
- `__tests__` convention;
- strong typing;
- no unverified `any`;
- legacy migration restrictions;
- performance principles;
- required verification commands.

Do not put the entire project design in `AGENTS.md`.

Place detailed architecture in a separate document such as:

```text
docs/architecture.md
```

Reference it from `AGENTS.md`.

## Part 3: type foundations

Implement or normalize:

```text
AnySchema
SchemaShape
InferSchema
SchemaLike
Infer
OptionalShape
RequiredShape
PartialShape
DeepPartialShape
DeepRequiredShape
ReadonlyShape
DeepReadonlyShape
PickShape
OmitShape
ExtendShape
MergeShape
```

Add type tests.

## Part 4: builder contracts

Implement:

```text
BuilderCore
Builder
AnyBuilder
BuilderSpecialization
BaseOperators
ObjectOperators
StringOperators
NumberOperators
ArrayOperators
SetOperators
MapOperators
TupleOperators
RecordOperators
```

Do not use `Builder<any>`.

## Part 5: minimal transforms

Implement only:

```text
optional
nullable
readonly
partial
required
```

Keep transform functions independent from builders.

## Part 6: minimal runtime chain

Implement:

```text
unwrapSchema
createBuilder
base builder prototype
object builder prototype
```

Adapt only the minimum factories required for:

```ts
const User = JIT.object({
  id: JIT.number(),
})
  .partial()
  .required()
  .readonly();
```

## Part 7: tests

Create colocated tests for:

- primitive factories;
- object factory;
- runtime `_type === null`;
- compile-time `_type`;
- `.schema`;
- `partial`;
- `required`;
- `readonly`;
- invalid operators;
- property order;
- stable AST shape;
- input schema immutability.

## Part 8: verification

Run:

```bash
pnpm format:check
pnpm lint:check
pnpm test
pnpm build
```

If formatting or lint checks fail only because of changed files, apply the relevant write command and inspect the diff.

Report every command and its actual result.

---

# 35. Definition of done

The initial operator-chain task is complete when:

1. The repository has been audited.
2. The migration plan maps legacy directories to new owners.
3. Durable conventions are documented.
4. The JIT object exposes the minimum required factories.
5. The following code works:

```ts
const User = JIT.object({
  id: JIT.number(),
})
  .partial()
  .required()
  .readonly();
```

6. `User.schema` exposes the AST.
7. Runtime schemas preserve:

```text
type
_type
def
annotations
```

8. `_type` is `null` at runtime.
9. `_type` retains its inferred TypeScript type.
10. `partial()` produces optional object properties.
11. `required()` restores required properties.
12. `readonly()` returns the intended readonly output type.
13. The original schema is not mutated.
14. Invalid operators are rejected by TypeScript.
15. No unjustified `any` is introduced.
16. Unit tests are colocated in `__tests__`.
17. Runtime and type-level tests pass.
18. Formatting passes.
19. Lint passes.
20. Build passes.
21. Legacy directories remain until migration conditions are satisfied.
22. The final diff has been reviewed for:

    - cycles;
    - type inference regressions;
    - public API regressions;
    - ESM import errors;
    - unstable object shapes;
    - unnecessary allocations;
    - tree-shaking regressions.

---

# 36. Expected final report

After completing each implementation stage, report:

## Repository state

- relevant files found;
- legacy architecture found;
- unexpected differences from this specification.

## Changes

- files created;
- files changed;
- files moved;
- compatibility exports added.

## Architecture

- decisions made;
- alternatives considered;
- assumptions made;
- namespace patterns preserved;
- callable-function patterns preserved.

## Typing

- exported types;
- assertions used;
- remaining `any`;
- type tests added;
- inference examples.

## Performance

- hot-path decisions;
- allocation decisions;
- object-shape decisions;
- generated-source decisions;
- benchmark results, if executed.

## Validation

For each command:

```text
command
result
relevant failures
fix applied
```

## Remaining work

- migration stages still pending;
- legacy modules still active;
- benchmark gaps;
- compatibility decisions requiring a major version.

Never claim that a command passed unless it was actually executed successfully.

---

# 37. Non-negotiable project principles

Always preserve these principles:

```text
Data-first AST
Separate fluent builder
Separate runtime transforms
Separate compiler infrastructure
Specialized generated execution
Strong TypeScript inference
Stable object shapes
Namespace-oriented modules
Callable functions with attached specialized operations
Colocated __tests__
ESM with .js import specifiers
Named exports
Tree-shakeable modules
Measured performance
Gradual legacy migration
```

Do not perform a broad rewrite just because the target architecture is cleaner.

Migrate incrementally, preserve behavior, test each boundary, and keep the codebase operational throughout the process.

Start by auditing the repository and producing the staged migration plan. Do not begin the broad implementation until that plan is grounded in the actual files.
