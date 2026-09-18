import type * as ATS from "../core/ats/index.js";
import { TypeName } from "../core/ats/index.js";
import { isTransparentWrapper } from "./runtime-type/transparent-wrapper.js";

/** Returns whether a schema resolves to a default wrapper. */
export function hasSchemaDefault(schema: ATS.AnyTypeSchema): boolean {
  let current = schema;

  while (true) {
    if (current.type === TypeName.default) return true;
    if (current.type === TypeName.lazy) {
      current = (current.def as ATS.LazyDef).getter();
      continue;
    }
    if (isTransparentWrapper(current.type)) {
      current = (current.def as ATS.InnerTypeDef).innerType;
      continue;
    }
    return false;
  }
}
