import { createSchema, type EmptyDef, TypeName, type VoidSchema } from "../../core/ats/index.js";
import type { Builder } from "../../core/builder/index.js";
import { createBuilder } from "../../core/builder/index.js";
import { emptyDef } from "./empty-def.js";

function voidType(): Builder<VoidSchema> {
  return /* @__PURE__ */ createBuilder(createSchema<void, "void", EmptyDef>(TypeName.void, emptyDef));
}

export { voidType as void };
