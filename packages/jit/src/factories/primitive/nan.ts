import { createSchema, type EmptyDef, type NanSchema, TypeName } from "../../core/ats/index.js";
import type { Builder } from "../../core/builder/index.js";
import { createBuilder } from "../../core/builder/index.js";
import { emptyDef } from "./empty-def.js";

export function nan(): Builder<NanSchema> {
  return /* @__PURE__ */ createBuilder(createSchema<number, "nan", EmptyDef>(TypeName.nan, emptyDef));
}
