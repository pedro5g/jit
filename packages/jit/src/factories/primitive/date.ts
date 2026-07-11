import { type ChecksDef, createSchema, type DateLikeCheck, type DateSchema, TypeName } from "../../core/ats/index.js";
import type { Builder } from "../../core/builder/index.js";
import { createBuilder } from "../../core/builder/index.js";
import { emptyDef } from "./empty-def.js";

/**
 * Creates a `Date` schema builder.
 *
 * @returns A builder wrapping a Date schema.
 */
export function date(): Builder<DateSchema<[]>> {
  return /* @__PURE__ */ createBuilder(
    createSchema<Date, "date", ChecksDef<DateLikeCheck, []>>(TypeName.date, emptyDef)
  );
}
