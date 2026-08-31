import { createSchema, type EmptyDef, type RegexSchema, TypeName } from "../../core/ats/index.js";
import type { Builder } from "../../core/builder/index.js";
import { createBuilder } from "../../core/builder/index.js";
import { type ValidationMessage, withValidationMessage } from "../validation-message.js";
import { emptyDef } from "./empty-def.js";

/**
 * Creates a `RegExp` schema builder.
 *
 * @returns A builder wrapping a RegExp schema.
 */
export function regex(message?: ValidationMessage): Builder<RegexSchema> {
  return /* @__PURE__ */ createBuilder(
    createSchema<RegExp, "regex", EmptyDef>(TypeName.regex, withValidationMessage(emptyDef, message))
  );
}
