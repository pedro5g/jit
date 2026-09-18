import { findRuntimeTypeSchema } from "../compiler/runtime-type/find-runtime-type-schema.js";
import type * as ATS from "../core/ats/index.js";

/** Detects identifier metadata through transparent schema wrappers. */
export function isIdentifierSchema(schema: ATS.AnyTypeSchema): boolean {
  return findRuntimeTypeSchema(schema)?.def.identifier === true;
}
