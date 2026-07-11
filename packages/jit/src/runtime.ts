/** Runtime JIT entrypoint: schema factories plus host-backed compiled operations. */

export type { Infer } from "./core/ats/infer.js";
export type { Strict } from "./core/builder/types.js";
export type {
  CompilationOptions,
  CompilationRequest,
  CompilerHost,
  OperationDescriptor,
} from "./core/host.js";
export * as JIT from "./factories/index.js";
