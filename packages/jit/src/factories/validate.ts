import { type CompiledValidator, compileValidator } from "../compiler/validate.js";
import type * as ATS from "../core/ats/index.js";
import type { SchemaInput } from "../core/builder/index.js";
import { unwrapSchema } from "../core/builder/index.js";
import type { CompileCacheOptions } from "../runtime/cache/compile-cache.js";

/**
 * Compiles the validator triple (`is`, `parse`, `safeParse`) for a schema.
 *
 * @example
 * ```ts
 * const User = JIT.object({
 *   name: JIT.string().min(2),
 *   email: JIT.string().email(),
 *   age: JIT.number().int().min(0),
 * });
 *
 * const Users = JIT.validator(User);
 *
 * Users.is(input);                 // boolean type guard, zero allocation
 * Users.parse(input);              // typed data or JITValidationError
 * const result = Users.safeParse(input);
 * if (!result.success) result.issues; // [{ path: "email", code: "invalid_format", ... }]
 * ```
 */
export function validator<TSchema extends ATS.AnyTypeSchema>(
  schema: SchemaInput<TSchema>,
  options?: CompileCacheOptions
): CompiledValidator<ATS.InferSchema<TSchema>> {
  return compileValidator(unwrapSchema(schema), options);
}
