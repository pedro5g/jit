import { TypeName } from "../../core/ats/index.js";

const TRANSPARENT_WRAPPER_TYPES: ReadonlySet<string> = new Set([
  TypeName.optional,
  TypeName.nullable,
  TypeName.nullish,
  TypeName.default,
  TypeName.brand,
  TypeName.readonly,
  TypeName.refine,
  TypeName.coerce,
  TypeName.pipe,
  TypeName.transform,
]);

/** Returns whether a schema node preserves the identity of its inner type. */
export function isTransparentWrapper(type: string): boolean {
  return TRANSPARENT_WRAPPER_TYPES.has(type);
}
