import { compileMask, type Mask } from "../compiler/mask.js";
import { compileSanitize, type Sanitize } from "../compiler/sanitize.js";
import type * as ATS from "../core/ats/index.js";
import type { SchemaInput } from "../core/builder/index.js";
import { unwrapSchema } from "../core/builder/index.js";
import type { CompileCacheOptions } from "../runtime/cache/compile-cache.js";

/**
 * Compiles a PII-masking function from the schema's `.pii()` markers.
 *
 * @example
 * ```ts
 * const User = JIT.object({
 *   id: JIT.number(),
 *   email: JIT.string().pii("mask"),
 *   password: JIT.string().pii(),        // redact -> "***"
 *   document: JIT.string().pii("hash"),  // FNV-1a hex digest
 * });
 *
 * const maskUser = JIT.mask(User);
 * logger.info(maskUser(user)); // sensitive fields never reach the log
 * ```
 */
export function mask<TSchema extends ATS.AnyTypeSchema>(
  schema: SchemaInput<TSchema>,
  options?: CompileCacheOptions
): Mask<ATS.InferSchema<TSchema>> {
  return compileMask(unwrapSchema(schema), options);
}

/**
 * Compiles an XSS-stripping function from the schema's `.sanitize()` markers.
 *
 * @example
 * ```ts
 * const Comment = JIT.object({
 *   id: JIT.number(),
 *   body: JIT.string().sanitize(),
 * });
 *
 * const cleanComment = JIT.sanitize(Comment);
 * cleanComment({ id: 1, body: "<script>steal()</script>hi" }).body; // "hi"
 * ```
 */
export function sanitize<TSchema extends ATS.AnyTypeSchema>(
  schema: SchemaInput<TSchema>,
  options?: CompileCacheOptions
): Sanitize<ATS.InferSchema<TSchema>> {
  return compileSanitize(unwrapSchema(schema), options);
}
