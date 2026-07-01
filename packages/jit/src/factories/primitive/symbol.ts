import { createSchema, type EmptyDef, type SymbolSchema, TypeName } from "../../core/ats/index.js";
import type { Builder } from "../../core/builder/index.js";
import { createBuilder } from "../../core/builder/index.js";
import { emptyDef } from "./empty-def.js";

export function symbol(): Builder<SymbolSchema> {
  return /* @__PURE__ */ createBuilder(createSchema<symbol, "symbol", EmptyDef>(TypeName.symbol, emptyDef));
}
