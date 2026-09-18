import { type ChecksDef, createSchema, type IntSchema, type NumberCheck, TypeName } from "../../core/ats/index.js";
import type { Builder } from "../../core/builder/index.js";
import { createBuilder } from "../../core/builder/index.js";
import { type ValidationMessage, withValidationMessage } from "../validation-message.js";
import { emptyDef } from "./empty-def.js";

/**
 * Creates an integer-number schema builder.
 *
 * @example
 * ```ts
 * import { JIT } from "@jit-compiler/jit";
 *
 * const Quantity = JIT.int();
 * JIT.validate.parse(Quantity)(3); // 3
 * ```
 *
 * @param message Optional default message for failures in this schema.
 * @returns A builder wrapping an int schema.
 */
export function int(message?: ValidationMessage): Builder<IntSchema<[]>> {
  return /* @__PURE__ */ createBuilder(
    createSchema<number, "int", ChecksDef<NumberCheck, []>>(TypeName.int, withValidationMessage(emptyDef, message))
  );
}
