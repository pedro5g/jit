import { createSchema, type EmptyDef, TypeName, type UndefinedSchema } from "../../core/ats/index.js";
import type { Builder } from "../../core/builder/index.js";
import { createBuilder } from "../../core/builder/index.js";
import { type ValidationMessage, withValidationMessage } from "../validation-message.js";
import { emptyDef } from "./empty-def.js";

/**
 * Creates an `undefined` schema builder.
 *
 * @returns A builder wrapping an undefined schema.
 */
function undefinedType(message?: ValidationMessage): Builder<UndefinedSchema> {
  return /* @__PURE__ */ createBuilder(
    createSchema<undefined, "undefined", EmptyDef>(TypeName.undefined, withValidationMessage(emptyDef, message))
  );
}

export { undefinedType as undefined };
