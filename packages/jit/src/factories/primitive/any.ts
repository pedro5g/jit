import { type AnyValueSchema, createSchema, type EmptyDef, TypeName } from "../../core/ats/index.js";
import type { Builder } from "../../core/builder/index.js";
import { createBuilder } from "../../core/builder/index.js";
import { emptyDef } from "./empty-def.js";

/**
 * Creates an `any` schema builder.
 *
 * @returns A builder wrapping an `any` schema.
 */
export function any(): Builder<AnyValueSchema> {
  return /* @__PURE__ */ createBuilder(createSchema<any, "any", EmptyDef>(TypeName.any, emptyDef));
}
