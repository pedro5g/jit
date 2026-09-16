import { type ChecksDef, createSchema, type StringCheck, type StringSchema, TypeName } from "../../core/ats/index.js";
import type { Builder } from "../../core/builder/index.js";
import { createBuilder } from "../../core/builder/index.js";
import { type ValidationMessage, withValidationMessage } from "../validation-message.js";
import { emptyDef } from "./empty-def.js";

/**
 * Creates a `string` schema builder.
 *
 * Chain checks and transforms on the returned builder; each call preserves the
 * inferred schema type for `JIT.Typeof` and for static default validation.
 *
 * @example
 * ```ts
 * import { JIT } from "@jit-compiler/jit";
 *
 * const Username = JIT.string().min(3).max(32).trim();
 * const parseUsername = JIT.validate.parse(Username);
 *
 * parseUsername("ada"); // "ada"
 * ```
 *
 * @param message Optional default message for failures in this schema.
 * @returns A builder wrapping a string schema.
 */
export function string(message?: ValidationMessage): Builder<StringSchema<[]>> {
  return /* @__PURE__ */ createBuilder(
    createSchema<string, "string", ChecksDef<StringCheck, []>>(
      TypeName.string,
      withValidationMessage(emptyDef, message)
    )
  );
}
