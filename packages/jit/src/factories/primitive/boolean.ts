import { type BooleanSchema, createSchema, type EmptyDef, TypeName } from "../../core/ats/index.js";
import type { Builder } from "../../core/builder/index.js";
import { createBuilder } from "../../core/builder/index.js";
import { emptyDef } from "./empty-def.js";

/**
 * Creates a `boolean` schema builder.
 *
 * @returns A builder wrapping a boolean schema.
 */
export function boolean(): Builder<BooleanSchema> {
  return /* @__PURE__ */ createBuilder(createSchema<boolean, "boolean", EmptyDef>(TypeName.boolean, emptyDef));
}
