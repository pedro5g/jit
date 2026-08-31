import { createSchema, type EmptyDef, TypeName, type VoidSchema } from "../../core/ats/index.js";
import type { Builder } from "../../core/builder/index.js";
import { createBuilder } from "../../core/builder/index.js";
import { type ValidationMessage, withValidationMessage } from "../validation-message.js";
import { emptyDef } from "./empty-def.js";

/**
 * Creates a `void` schema builder.
 *
 * @returns A builder wrapping a void schema.
 */
function voidType(message?: ValidationMessage): Builder<VoidSchema> {
  return /* @__PURE__ */ createBuilder(
    createSchema<void, "void", EmptyDef>(TypeName.void, withValidationMessage(emptyDef, message))
  );
}

export { voidType as void };
