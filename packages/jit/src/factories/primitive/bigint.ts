import { type BigIntSchema, createSchema, type EmptyDef, TypeName } from "../../core/ats/index.js";
import type { Builder } from "../../core/builder/index.js";
import { createBuilder } from "../../core/builder/index.js";
import { type ValidationMessage, withValidationMessage } from "../validation-message.js";
import { emptyDef } from "./empty-def.js";

/**
 * Creates a `bigint` schema builder.
 *
 * @example
 * ```ts
 * import { JIT } from "@jit-compiler/jit";
 *
 * const Counter = JIT.bigint();
 * JIT.validate.parse(Counter)(42n); // 42n
 * ```
 *
 * @param message Optional default message for failures in this schema.
 * @returns A builder wrapping a bigint schema.
 */
export function bigint(message?: ValidationMessage): Builder<BigIntSchema> {
  return /* @__PURE__ */ createBuilder(
    createSchema<bigint, "bigint", EmptyDef>(TypeName.bigint, withValidationMessage(emptyDef, message))
  );
}
