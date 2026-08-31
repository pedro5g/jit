import { type ChecksDef, createSchema, type IntSchema, type NumberCheck, TypeName } from "../../core/ats/index.js";
import type { Builder } from "../../core/builder/index.js";
import { createBuilder } from "../../core/builder/index.js";
import { type ValidationMessage, withValidationMessage } from "../validation-message.js";
import { emptyDef } from "./empty-def.js";

/**
 * Creates an integer-number schema builder.
 *
 * @returns A builder wrapping an int schema.
 */
export function int(message?: ValidationMessage): Builder<IntSchema<[]>> {
  return /* @__PURE__ */ createBuilder(
    createSchema<number, "int", ChecksDef<NumberCheck, []>>(TypeName.int, withValidationMessage(emptyDef, message))
  );
}
