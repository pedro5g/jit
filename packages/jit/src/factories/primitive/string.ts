import { createSchema, type EmptyDef, type StringSchema, TypeName } from "../../core/ats/index.js";
import type { Builder } from "../../core/builder/index.js";
import { createBuilder } from "../../core/builder/index.js";
import { emptyDef } from "./empty-def.js";

/**
 * Creates a `string` schema builder.
 *
 * @returns A builder wrapping a string schema.
 */
export function string(): Builder<StringSchema> {
  return /* @__PURE__ */ createBuilder(createSchema<string, "string", EmptyDef>(TypeName.string, emptyDef));
}
