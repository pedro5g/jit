import { createSchema, type EmptyDef, TypeName, type VoidSchema } from "../../core/ats/index.js";
import type { Builder } from "../../core/builder/index.js";
import { createBuilder } from "../../core/builder/index.js";
import { type ValidationMessage, withValidationMessage } from "../validation-message.js";
import { emptyDef } from "./empty-def.js";

/**
 * Creates a `void` schema builder.
 *
 * @example
 * ```ts
 * import { JIT } from "@jit-compiler/jit";
 *
 * const Result = JIT.void();
 * JIT.validate.is(Result)(undefined); // true
 * ```
 *
 * @param message Optional default message for failures in this schema.
 * @returns A builder wrapping a void schema.
 */
function voidType(message?: ValidationMessage): Builder<VoidSchema> {
  return /* @__PURE__ */ createBuilder(
    createSchema<void, "void", EmptyDef>(TypeName.void, withValidationMessage(emptyDef, message))
  );
}

/** Provides the JIT void operation for the supplied input. */
export { voidType as void };
