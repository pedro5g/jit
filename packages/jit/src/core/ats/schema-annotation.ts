import type { CompileHints, Metadata } from "../hints/index.js";

export interface SchemaAnnotations<T = unknown> {
  hints?: CompileHints<T>;
  metadata?: Metadata;
}
