import { createSchema, type EmptyDef, type StringSchema, TypeName } from "../../core/ats/index.js";
import type { Builder } from "../../core/builder/index.js";
import { createBuilder } from "../../core/builder/index.js";
import { emptyDef } from "./empty-def.js";

export function string(): Builder<StringSchema> {
  return /* @__PURE__ */ createBuilder(createSchema<string, "string", EmptyDef>(TypeName.string, emptyDef));
}
