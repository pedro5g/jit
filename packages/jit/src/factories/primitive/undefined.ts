import { createSchema, type EmptyDef, TypeName, type UndefinedSchema } from "../../core/ats/index.js";
import type { Builder } from "../../core/builder/index.js";
import { createBuilder } from "../../core/builder/index.js";
import { emptyDef } from "./empty-def.js";

/**
 * Creates an `undefined` schema builder.
 *
 * @returns A builder wrapping an undefined schema.
 */
function undefinedType(): Builder<UndefinedSchema> {
  return /* @__PURE__ */ createBuilder(createSchema<undefined, "undefined", EmptyDef>(TypeName.undefined, emptyDef));
}

export { undefinedType as undefined };
