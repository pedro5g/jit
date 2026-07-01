import { createSchema, type EmptyDef, type NullSchema, TypeName } from "../../core/ats/index.js";
import type { Builder } from "../../core/builder/index.js";
import { createBuilder } from "../../core/builder/index.js";
import { emptyDef } from "./empty-def.js";

function nullType(): Builder<NullSchema> {
  return /* @__PURE__ */ createBuilder(createSchema<null, "null", EmptyDef>(TypeName.null, emptyDef));
}

export { nullType as null };
