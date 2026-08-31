import { createSchema, type EmptyDef, type NullSchema, TypeName } from "../../core/ats/index.js";
import type { Builder } from "../../core/builder/index.js";
import { createBuilder } from "../../core/builder/index.js";
import { type ValidationMessage, withValidationMessage } from "../validation-message.js";
import { emptyDef } from "./empty-def.js";

/**
 * Creates a `null` schema builder.
 *
 * @returns A builder wrapping a null schema.
 */
function nullType(message?: ValidationMessage): Builder<NullSchema> {
  return /* @__PURE__ */ createBuilder(
    createSchema<null, "null", EmptyDef>(TypeName.null, withValidationMessage(emptyDef, message))
  );
}

export { nullType as null };
