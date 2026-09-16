/** Runtime JIT entrypoint: schema factories plus host-backed compiled operations. */

export type Typeof<TSchemaLike> = import("./core/ats/typeof.js").Typeof<TSchemaLike>;
/** Describes the JIT input contract used by the public API. */
export type Input<TSchemaLike> = import("./core/ats/input.js").Input<TSchemaLike>;
/** Describes the JIT hydrate contract used by the public API. */
export type Hydrate<TSchemaLike> = import("./core/ats/representations.js").Hydrate<TSchemaLike>;
/** Describes the JIT wire contract used by the public API. */
export type Wire<TSchemaLike> = import("./core/ats/representations.js").Wire<TSchemaLike>;
/** Describes the JIT update contract used by the public API. */
export type Update<TSchemaLike> = import("./core/ats/input.js").Update<TSchemaLike>;
export type { Strict } from "./core/builder/types.js";
export type {
  CompilationOptions,
  CompilationRequest,
  CompilerHost,
  OperationDescriptor,
} from "./core/host.js";
export * as JIT from "./factories/index.js";
