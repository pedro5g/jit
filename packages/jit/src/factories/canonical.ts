import { compileCanonical } from "../compiler/canonical.js";
import type * as ATS from "../core/ats/index.js";
import type { SchemaInput } from "../core/builder/index.js";
import { unwrapSchema } from "../core/builder/index.js";

/**
 * One deterministic representation for values that are semantically the same.
 *
 * Two objects with the same fields in different insertion order read the same
 * and serialize differently. `canonical` puts the fields in the order the
 * schema declares them — and returns the original value by reference when it is
 * already in that order, so the common case allocates nothing.
 *
 * @example
 * ```ts
 * const User = JIT.object({ id: JIT.number(), name: JIT.string() });
 * const normalize = JIT.canonical(User);
 * normalize({ name: "Ada", id: 1 }); // { id: 1, name: "Ada" }
 * ```
 */
export function canonical<TSchema extends ATS.AnyTypeSchema>(
  schema: SchemaInput<TSchema>
): (value: ATS.TypeofSchema<TSchema>) => ATS.TypeofSchema<TSchema> {
  return compileCanonical<ATS.TypeofSchema<TSchema>>(unwrapSchema(schema));
}
