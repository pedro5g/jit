import { createSchema, type EmptyDef, TypeName, type UndefinedSchema } from "../../core/ats/index.js";
import type { Builder } from "../../core/builder/index.js";
import { createBuilder } from "../../core/builder/index.js";
import { type ValidationMessage, withValidationMessage } from "../validation-message.js";
import { emptyDef } from "./empty-def.js";

/**
 * Creates an `undefined` schema builder.
 *
 * @example
 * ```ts
 * import { JIT } from "@jit-compiler/jit";
 *
 * const Missing = JIT.undefined();
 * JIT.validate.is(Missing)(undefined); // true
 * ```
 *
 * @param message Optional default message for failures in this schema.
 * @returns A builder wrapping an undefined schema.
 */
function undefinedType(message?: ValidationMessage): Builder<UndefinedSchema> {
  return /* @__PURE__ */ createBuilder(
    createSchema<undefined, "undefined", EmptyDef>(TypeName.undefined, withValidationMessage(emptyDef, message))
  );
}

/** Provides the JIT undefined operation for the supplied input. */
export { undefinedType as undefined };
