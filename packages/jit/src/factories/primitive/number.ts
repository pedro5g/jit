import { type ChecksDef, createSchema, type NumberCheck, type NumberSchema, TypeName } from "../../core/ats/index.js";
import type { Builder } from "../../core/builder/index.js";
import { createBuilder } from "../../core/builder/index.js";
import { emptyDef } from "./empty-def.js";

/**
 * Creates a `number` schema builder.
 *
 * @returns A builder wrapping a number schema.
 */
export function number(): Builder<NumberSchema<[]>> {
  return /* @__PURE__ */ createBuilder(
    createSchema<number, "number", ChecksDef<NumberCheck, []>>(TypeName.number, emptyDef)
  );
}
