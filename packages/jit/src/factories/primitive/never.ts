import { createSchema, type EmptyDef, type NeverSchema, TypeName } from "../../core/ats/index.js";
import type { Builder } from "../../core/builder/index.js";
import { createBuilder } from "../../core/builder/index.js";
import { type ValidationMessage, withValidationMessage } from "../validation-message.js";
import { emptyDef } from "./empty-def.js";

/**
 * Creates a `never` schema builder.
 *
 * @example
 * ```ts
 * import { JIT } from "@jit-compiler/jit";
 *
 * const Unreachable = JIT.never();
 * JIT.validate.is(Unreachable)(undefined); // false
 * ```
 *
 * @param message Optional default message for failures in this schema.
 * @returns A builder wrapping a never schema.
 */
export function never(message?: ValidationMessage): Builder<NeverSchema> {
  return /* @__PURE__ */ createBuilder(
    createSchema<never, "never", EmptyDef>(TypeName.never, withValidationMessage(emptyDef, message))
  );
}
