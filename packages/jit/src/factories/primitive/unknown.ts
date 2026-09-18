import { createSchema, type EmptyDef, TypeName, type UnknownSchema } from "../../core/ats/index.js";
import type { Builder } from "../../core/builder/index.js";
import { createBuilder } from "../../core/builder/index.js";
import { emptyDef } from "./empty-def.js";

/**
 * Creates an `unknown` schema builder.
 *
 * @example
 * ```ts
 * import { JIT } from "@jit-compiler/jit";
 *
 * const Payload = JIT.unknown();
 * JIT.validate.is(Payload)({ anything: "goes" }); // true
 * ```
 *
 * @returns A builder wrapping an unknown schema.
 */
export function unknown(): Builder<UnknownSchema> {
  return /* @__PURE__ */ createBuilder(createSchema<unknown, "unknown", EmptyDef>(TypeName.unknown, emptyDef));
}
