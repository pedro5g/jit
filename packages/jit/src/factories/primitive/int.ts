import { createSchema, type EmptyDef, type IntSchema, TypeName } from "../../core/ats/index.js";
import type { Builder } from "../../core/builder/index.js";
import { createBuilder } from "../../core/builder/index.js";
import { emptyDef } from "./empty-def.js";

export function int(): Builder<IntSchema> {
  return /* @__PURE__ */ createBuilder(createSchema<number, "int", EmptyDef>(TypeName.int, emptyDef));
}
