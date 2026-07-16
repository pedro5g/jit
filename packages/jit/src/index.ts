/**
 * JIT - describe a data structure once, compile specialized JavaScript
 * operations over it.
 *
 * Instead of interpreting a schema on every call, JIT generates readable,
 * engine-friendly source for each operation (equality, cloning, diffing,
 * immutable updates, queries, watching, pipelines) and pays the compilation
 * cost once.
 *
 * @example
 * ```ts
 * import { JIT } from "@jit-compiler/jit";
 *
 * const User = JIT.object({ id: JIT.number(), name: JIT.string() });
 * const equal = JIT.compileEqual(User.schema);
 *
 * equal({ id: 1, name: "Ada" }, { id: 1, name: "Ada" }); // true
 * ```
 */

/** Prisma-style AOT generator: writes pure `.js` + `.d.ts` modules for schemas. */
export * as AOT from "./aot/index.js";
/** Low-level compilers and IR utilities (`compileEqual`, `emitEqualSource`, IR builders/optimizer). */
export * as Compiler from "./compiler/index.js";
/** Data-first AST nodes consumed by the query/update/transform compilers. */
export * as PipelineAST from "./core/ast/index.js";
/** Schema AST: node factories, `TypeName`, and type helpers. */
export * as AST from "./core/ats/index.js";
/**
 * Resolves the TypeScript type of a schema or builder. Root-level export so
 * generated declarations can reference `import("@jit-compiler/jit").Typeof<...>`.
 */
export type Typeof<TSchemaLike> = import("./core/ats/typeof.js").Typeof<TSchemaLike>;
/** Fluent builder chain internals (`createBuilder`, builder types). */
export * as Builder from "./core/builder/index.js";
export type { Strict } from "./core/builder/types.js";
export type {
  AnyCompiledFunction,
  AOTArtifact,
  ArtifactDescriptor,
  CompilationOptions,
  CompilationRequest,
  CompiledArtifact,
  CompilerHost,
  OperationDescriptor,
  SchemaMetadata,
} from "./core/host.js";
/** Shared host contracts used by runtime JIT and AOT definition entrypoints. */
export * as Host from "./core/host.js";
/** Typed error classes thrown by compiled functions (`JITError`). */
export * as Errors from "./errors/index.js";
/** The main public API: schema factories plus every `compile*` entry point. */
export * as JIT from "./factories/index.js";
/** Runtime helpers referenced by generated (AOT) code (`getIndex`, hash primitives). */
export * as Runtime from "./runtime/runtime.js";
/** Pure schema-to-schema transforms (`partial`, `pick`, `omit`, wrappers). */
export * as Transform from "./transforms/index.js";
