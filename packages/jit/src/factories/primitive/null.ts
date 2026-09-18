import { createSchema, type EmptyDef, type NullSchema, TypeName } from "../../core/ats/index.js";
import type { Builder } from "../../core/builder/index.js";
import { createBuilder } from "../../core/builder/index.js";
import { type ValidationMessage, withValidationMessage } from "../validation-message.js";
import { emptyDef } from "./empty-def.js";

/**
 * Creates a `null` schema builder.
 *
 * @example
 * ```ts
 * import { JIT } from "@jit-compiler/jit";
 *
 * const Empty = JIT.null();
 * JIT.validate.parse(Empty)(null); // null
 * ```
 *
 * @param message Optional default message for failures in this schema.
 * @returns A builder wrapping a null schema.
 */
function nullType(message?: ValidationMessage): Builder<NullSchema> {
  return /* @__PURE__ */ createBuilder(
    createSchema<null, "null", EmptyDef>(TypeName.null, withValidationMessage(emptyDef, message))
  );
}

/** Provides the JIT null operation for the supplied input. */
export { nullType as null };
