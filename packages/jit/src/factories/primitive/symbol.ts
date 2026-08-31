import { createSchema, type EmptyDef, type SymbolSchema, TypeName } from "../../core/ats/index.js";
import type { Builder } from "../../core/builder/index.js";
import { createBuilder } from "../../core/builder/index.js";
import { type ValidationMessage, withValidationMessage } from "../validation-message.js";
import { emptyDef } from "./empty-def.js";

/**
 * Creates a `symbol` schema builder.
 *
 * @returns A builder wrapping a symbol schema.
 */
export function symbol(message?: ValidationMessage): Builder<SymbolSchema> {
  return /* @__PURE__ */ createBuilder(
    createSchema<symbol, "symbol", EmptyDef>(TypeName.symbol, withValidationMessage(emptyDef, message))
  );
}
