import type * as ATS from "../../core/ats/index.js";
import { TypeName } from "../../core/ats/index.js";
import { isTransparentWrapper } from "./transparent-wrapper.js";

/** Finds a Runtime Type through the wrappers that preserve its identity. */
export function findRuntimeTypeSchema(schema: ATS.AnyTypeSchema): ATS.RuntimeTypeSchema | undefined {
  let current = schema;

  while (true) {
    if (current.type === TypeName.runtimeType) return current as ATS.RuntimeTypeSchema;
    if (current.type === TypeName.lazy) {
      current = (current.def as ATS.LazyDef).getter();
      continue;
    }
    if (isTransparentWrapper(current.type)) {
      current = (current.def as ATS.InnerTypeDef).innerType;
      continue;
    }
    return undefined;
  }
}
