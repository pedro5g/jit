import { type BigIntSchema, createSchema, type EmptyDef, TypeName } from "../../core/ats/index.js";
import type { Builder } from "../../core/builder/index.js";
import { createBuilder } from "../../core/builder/index.js";
import { emptyDef } from "./empty-def.js";

export function bigint(): Builder<BigIntSchema> {
  return /* @__PURE__ */ createBuilder(createSchema<bigint, "bigint", EmptyDef>(TypeName.bigint, emptyDef));
}
