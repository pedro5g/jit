import { createSchema, type EmptyDef, type NeverSchema, TypeName } from "../../core/ats/index.js";
import type { Builder } from "../../core/builder/index.js";
import { createBuilder } from "../../core/builder/index.js";
import { emptyDef } from "./empty-def.js";

export function never(): Builder<NeverSchema> {
  return /* @__PURE__ */ createBuilder(createSchema<never, "never", EmptyDef>(TypeName.never, emptyDef));
}
