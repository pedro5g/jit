/** Runtime JIT entrypoint: schema factories plus host-backed compiled operations. */

export type Typeof<TSchemaLike> = import("./core/ats/infer.js").Typeof<TSchemaLike>;
/** @deprecated Use `Typeof<TSchema>` instead. */
export type Infer<TSchemaLike> = Typeof<TSchemaLike>;
export type { Strict } from "./core/builder/types.js";
export type {
  CompilationOptions,
  CompilationRequest,
  CompilerHost,
  OperationDescriptor,
} from "./core/host.js";
export * as JIT from "./factories/index.js";
