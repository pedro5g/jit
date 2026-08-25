/** Runtime JIT entrypoint: schema factories plus host-backed compiled operations. */

export type Typeof<TSchemaLike> = import("./core/ats/typeof.js").Typeof<TSchemaLike>;
export type Input<TSchemaLike> = import("./core/ats/input.js").Input<TSchemaLike>;
export type Hydrate<TSchemaLike> = import("./core/ats/representations.js").Hydrate<TSchemaLike>;
export type Wire<TSchemaLike> = import("./core/ats/representations.js").Wire<TSchemaLike>;
export type Update<TSchemaLike> = import("./core/ats/input.js").Update<TSchemaLike>;
export type { Strict } from "./core/builder/types.js";
export type {
  CompilationOptions,
  CompilationRequest,
  CompilerHost,
  OperationDescriptor,
} from "./core/host.js";
export * as JIT from "./factories/index.js";
