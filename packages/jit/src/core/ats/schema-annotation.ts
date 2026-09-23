import type { CompileHints, Metadata } from "../hints/index.js";

/** Describes the JIT schema annotations contract used by the public API. */
export interface SchemaAnnotations<T = unknown> {
  hints?: CompileHints<T>;
  /** Legacy descriptive metadata retained for imported schemas and DTO marks. */
  metadata?: Metadata;
}
