import { createSchema, type EmptyDef, type NeverSchema, TypeName } from "../../core/ats/index.js";
import type { Builder } from "../../core/builder/index.js";
import { createBuilder } from "../../core/builder/index.js";
import { type ValidationMessage, withValidationMessage } from "../validation-message.js";
import { emptyDef } from "./empty-def.js";

/**
 * Creates a `never` schema builder.
 *
 * @returns A builder wrapping a never schema.
 */
export function never(message?: ValidationMessage): Builder<NeverSchema> {
  return /* @__PURE__ */ createBuilder(
    createSchema<never, "never", EmptyDef>(TypeName.never, withValidationMessage(emptyDef, message))
  );
}
