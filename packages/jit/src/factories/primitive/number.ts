import { createSchema, type EmptyDef, type NumberSchema, TypeName } from "../../core/ats/index.js";
import type { Builder } from "../../core/builder/index.js";
import { createBuilder } from "../../core/builder/index.js";
import { emptyDef } from "./empty-def.js";

export function number(): Builder<NumberSchema> {
  return /* @__PURE__ */ createBuilder(createSchema<number, "number", EmptyDef>(TypeName.number, emptyDef));
}
