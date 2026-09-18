import { createSchema, type EmptyDef, type RegexSchema, TypeName } from "../../core/ats/index.js";
import type { Builder } from "../../core/builder/index.js";
import { createBuilder } from "../../core/builder/index.js";
import { type ValidationMessage, withValidationMessage } from "../validation-message.js";
import { emptyDef } from "./empty-def.js";

/**
 * Creates a `RegExp` schema builder.
 *
 * @example
 * ```ts
 * import { JIT } from "@jit-compiler/jit";
 *
 * const Pattern = JIT.regex();
 * JIT.validate.is(Pattern)(/^[a-z]+$/); // true
 * ```
 *
 * @param message Optional default message for failures in this schema.
 * @returns A builder wrapping a RegExp schema.
 */
export function regex(message?: ValidationMessage): Builder<RegexSchema> {
  return /* @__PURE__ */ createBuilder(
    createSchema<RegExp, "regex", EmptyDef>(TypeName.regex, withValidationMessage(emptyDef, message))
  );
}
