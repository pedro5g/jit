import { createSchema, type EmptyDef, type NanSchema, TypeName } from "../../core/ats/index.js";
import type { Builder } from "../../core/builder/index.js";
import { createBuilder } from "../../core/builder/index.js";
import { type ValidationMessage, withValidationMessage } from "../validation-message.js";
import { emptyDef } from "./empty-def.js";

/**
 * Creates a `NaN` schema builder.
 *
 * @returns A builder wrapping a NaN schema.
 */
export function nan(message?: ValidationMessage): Builder<NanSchema> {
  return /* @__PURE__ */ createBuilder(
    createSchema<number, "nan", EmptyDef>(TypeName.nan, withValidationMessage(emptyDef, message))
  );
}
