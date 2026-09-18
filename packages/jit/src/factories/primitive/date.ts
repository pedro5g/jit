import { type ChecksDef, createSchema, type DateLikeCheck, type DateSchema, TypeName } from "../../core/ats/index.js";
import type { Builder } from "../../core/builder/index.js";
import { createBuilder } from "../../core/builder/index.js";
import { type ValidationMessage, withValidationMessage } from "../validation-message.js";
import { emptyDef } from "./empty-def.js";

/**
 * Creates a `Date` schema builder.
 *
 * @example
 * ```ts
 * import { JIT } from "@jit-compiler/jit";
 *
 * const CreatedAt = JIT.date();
 * JIT.validate.is(CreatedAt)(new Date()); // true
 * ```
 *
 * @param message Optional default message for failures in this schema.
 * @returns A builder wrapping a Date schema.
 */
export function date(message?: ValidationMessage): Builder<DateSchema<[]>> {
  return /* @__PURE__ */ createBuilder(
    createSchema<Date, "date", ChecksDef<DateLikeCheck, []>>(TypeName.date, withValidationMessage(emptyDef, message))
  );
}
