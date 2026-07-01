import { createSchema, type EmptyDef, type RegexSchema, TypeName } from "../../core/ats/index.js";
import type { Builder } from "../../core/builder/index.js";
import { createBuilder } from "../../core/builder/index.js";
import { emptyDef } from "./empty-def.js";

export function regex(): Builder<RegexSchema> {
  return /* @__PURE__ */ createBuilder(createSchema<RegExp, "regex", EmptyDef>(TypeName.regex, emptyDef));
}
