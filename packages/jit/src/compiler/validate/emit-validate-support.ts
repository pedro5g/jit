import { TypeName } from "../../core/ats/index.js";
import { needsBuild } from "../validate/emit-validate-helpers.js";
import type { AnySchema, SchemaCheckRecord } from "./emit-validate.js";

/**
 * True when `is(value)` can be used as the allocation-free success path for
 * `parse(value)`. Invalid values may then run the issue emitter, so schemas
 * with observable predicates or stateful regular expressions stay single-pass.
 */
export function canUseFastParse(
  schema: import("../../core/ats/index.js").AnyTypeSchema,
  seen = new Set<import("../../core/ats/index.js").AnyTypeSchema>()
): boolean {
  if (seen.has(schema)) return true;
  if (needsBuild(schema) || rootHasReadonly(schema)) return false;
  seen.add(schema);
  const current = schema as AnySchema;

  switch (current.type) {
    case TypeName.refine:
    case TypeName.coerce:
    case TypeName.pipe:
    case TypeName.transform:
    case TypeName.custom:
    case TypeName.codec:
    case TypeName.instanceof:
      return false;
    case TypeName.lazy:
      return canUseFastParse((current.def.getter as () => import("../../core/ats/index.js").AnyTypeSchema)(), seen);
    case TypeName.when:
      return (
        typeof current.def.is !== "function" &&
        canUseFastParse(current.def.thenType as import("../../core/ats/index.js").AnyTypeSchema, seen) &&
        canUseFastParse(current.def.otherwiseType as import("../../core/ats/index.js").AnyTypeSchema, seen)
      );
    case TypeName.optional:
    case TypeName.nullable:
    case TypeName.nullish:
    case TypeName.brand:
    case TypeName.readonly:
    case TypeName.not:
      return canUseFastParse(current.def.innerType as import("../../core/ats/index.js").AnyTypeSchema, seen);
    case TypeName.string: {
      const checks = (current.def.checks as readonly SchemaCheckRecord[] | undefined) ?? [];

      return !checks.some((check) => check.value instanceof RegExp && (check.value.global || check.value.sticky));
    }
    case TypeName.array:
    case TypeName.set:
      return canUseFastParse(current.def.element as import("../../core/ats/index.js").AnyTypeSchema, seen);
    case TypeName.map:
      return (
        canUseFastParse(current.def.key as import("../../core/ats/index.js").AnyTypeSchema, seen) &&
        canUseFastParse(current.def.value as import("../../core/ats/index.js").AnyTypeSchema, seen)
      );
    case TypeName.record:
      return canUseFastParse(current.def.value as import("../../core/ats/index.js").AnyTypeSchema, seen);
    case TypeName.tuple: {
      const items = (current.def.items as readonly import("../../core/ats/index.js").AnyTypeSchema[] | undefined) ?? [];
      const rest = current.def.rest as import("../../core/ats/index.js").AnyTypeSchema | undefined;

      return items.every((item) => canUseFastParse(item, seen)) && (rest === undefined || canUseFastParse(rest, seen));
    }
    case TypeName.union:
    case TypeName.xor:
    case TypeName.discriminatedUnion:
    case TypeName.intersection:
      return (current.def.options as readonly import("../../core/ats/index.js").AnyTypeSchema[]).every((option) =>
        canUseFastParse(option, seen)
      );
    case TypeName.object: {
      const props = current.def.props as Readonly<Record<string, import("../../core/ats/index.js").AnyTypeSchema>>;
      const catchall = current.def.catchall as import("../../core/ats/index.js").AnyTypeSchema | undefined;

      return (
        Object.keys(props).every((key) => canUseFastParse(props[key], seen)) &&
        (catchall === undefined || canUseFastParse(catchall, seen))
      );
    }
    default:
      return true;
  }
}

/** True when the subtree contains a promise wrapper. */
export function containsPromise(
  schema: import("../../core/ats/index.js").AnyTypeSchema,
  seen = new Set<import("../../core/ats/index.js").AnyTypeSchema>()
): boolean {
  if (seen.has(schema)) return false;
  seen.add(schema);

  const current = schema as AnySchema & { readonly schema?: import("../../core/ats/index.js").AnyTypeSchema };

  if (current.def === undefined) {
    return current.schema !== undefined && containsPromise(current.schema, seen);
  }

  if (current.type === TypeName.promise) return true;

  const def = current.def as {
    innerType?: import("../../core/ats/index.js").AnyTypeSchema;
    element?: import("../../core/ats/index.js").AnyTypeSchema;
    key?: import("../../core/ats/index.js").AnyTypeSchema;
    value?: import("../../core/ats/index.js").AnyTypeSchema;
    input?: import("../../core/ats/index.js").AnyTypeSchema;
    output?: import("../../core/ats/index.js").AnyTypeSchema;
    thenType?: import("../../core/ats/index.js").AnyTypeSchema;
    otherwiseType?: import("../../core/ats/index.js").AnyTypeSchema;
    items?: readonly import("../../core/ats/index.js").AnyTypeSchema[];
    rest?: import("../../core/ats/index.js").AnyTypeSchema;
    options?: readonly import("../../core/ats/index.js").AnyTypeSchema[];
    props?: Readonly<Record<string, import("../../core/ats/index.js").AnyTypeSchema>>;
  };

  if (def.innerType && containsPromise(def.innerType, seen)) return true;
  if (def.element && containsPromise(def.element, seen)) return true;
  if (def.key && containsPromise(def.key, seen)) return true;
  if (def.value && containsPromise(def.value, seen)) return true;
  if (def.input && containsPromise(def.input, seen)) return true;
  if (def.output && containsPromise(def.output, seen)) return true;
  if (def.thenType && containsPromise(def.thenType, seen)) return true;
  if (def.otherwiseType && containsPromise(def.otherwiseType, seen)) return true;
  if (def.rest && containsPromise(def.rest, seen)) return true;
  if (def.items?.some((item) => containsPromise(item, seen))) return true;
  if (def.options?.some((option) => containsPromise(option, seen))) return true;
  if (
    def.props &&
    Object.keys(def.props).some((key) =>
      containsPromise(def.props?.[key] as import("../../core/ats/index.js").AnyTypeSchema, seen)
    )
  )
    return true;
  return false;
}

/** True when a root wrapper requires the diagnostic result to be frozen. */
export function rootHasReadonly(
  schema: import("../../core/ats/index.js").AnyTypeSchema,
  seen = new Set<import("../../core/ats/index.js").AnyTypeSchema>()
): boolean {
  if (seen.has(schema)) return false;
  seen.add(schema);

  const current = schema as AnySchema;

  if (current.type === TypeName.readonly) return true;
  if (current.type === TypeName.lazy)
    return rootHasReadonly((current.def.getter as () => import("../../core/ats/index.js").AnyTypeSchema)(), seen);

  switch (current.type) {
    case TypeName.optional:
    case TypeName.nullable:
    case TypeName.nullish:
    case TypeName.default:
    case TypeName.brand:
    case TypeName.refine:
    case TypeName.coerce:
    case TypeName.pipe:
    case TypeName.transform:
      return rootHasReadonly(current.def.innerType as import("../../core/ats/index.js").AnyTypeSchema, seen);
    case TypeName.when:
      return (
        rootHasReadonly(current.def.thenType as import("../../core/ats/index.js").AnyTypeSchema, seen) ||
        rootHasReadonly(current.def.otherwiseType as import("../../core/ats/index.js").AnyTypeSchema, seen)
      );
    case TypeName.not:
      return rootHasReadonly(current.def.innerType as import("../../core/ats/index.js").AnyTypeSchema, seen);
    default:
      return false;
  }
}
