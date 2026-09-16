import type { CompileHints, Metadata } from "../hints/index.js";

/** Describes the JIT schema annotations contract used by the public API. */
export interface SchemaAnnotations<T = unknown> {
  hints?: CompileHints<T>;
  metadata?: Metadata;
}
