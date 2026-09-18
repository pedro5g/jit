import { type ChecksDef, createSchema, type NumberCheck, type NumberSchema, TypeName } from "../../core/ats/index.js";
import type { Builder } from "../../core/builder/index.js";
import { createBuilder } from "../../core/builder/index.js";
import { type ValidationMessage, withValidationMessage } from "../validation-message.js";
import { emptyDef } from "./empty-def.js";

/**
 * Creates a `number` schema builder.
 *
 * @example
 * ```ts
 * import { JIT } from "@jit-compiler/jit";
 *
 * const Price = JIT.number().nonnegative();
 * JIT.validate.parse(Price)(12.5); // 12.5
 * ```
 *
 * @param message Optional default message for failures in this schema.
 * @returns A builder wrapping a number schema.
 */
export function number(message?: ValidationMessage): Builder<NumberSchema<[]>> {
  return /* @__PURE__ */ createBuilder(
    createSchema<number, "number", ChecksDef<NumberCheck, []>>(
      TypeName.number,
      withValidationMessage(emptyDef, message)
    )
  );
}
