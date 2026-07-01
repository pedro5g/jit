import { createSchema, type DateSchema, type EmptyDef, TypeName } from "../../core/ats/index.js";
import type { Builder } from "../../core/builder/index.js";
import { createBuilder } from "../../core/builder/index.js";
import { emptyDef } from "./empty-def.js";

export function date(): Builder<DateSchema> {
  return /* @__PURE__ */ createBuilder(createSchema<Date, "date", EmptyDef>(TypeName.date, emptyDef));
}
