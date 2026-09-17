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
  return FAST_PARSE_DECISIONS[current.type]?.(current, seen) ?? true;
}

type SchemaDecision = (schema: AnySchema, seen: Set<import("../../core/ats/index.js").AnyTypeSchema>) => boolean;

const FAST_PARSE_DECISIONS: Readonly<Record<string, SchemaDecision>> = {
  [TypeName.refine]: alwaysFalse,
  [TypeName.coerce]: alwaysFalse,
  [TypeName.pipe]: alwaysFalse,
  [TypeName.transform]: alwaysFalse,
  [TypeName.custom]: alwaysFalse,
  [TypeName.codec]: alwaysFalse,
  [TypeName.instanceof]: alwaysFalse,
  [TypeName.lazy]: fastParseLazy,
  [TypeName.when]: fastParseWhen,
  [TypeName.optional]: fastParseInner,
  [TypeName.nullable]: fastParseInner,
  [TypeName.nullish]: fastParseInner,
  [TypeName.brand]: fastParseInner,
  [TypeName.readonly]: fastParseInner,
  [TypeName.not]: fastParseInner,
  [TypeName.string]: fastParseString,
  [TypeName.array]: fastParseElement,
  [TypeName.set]: fastParseElement,
  [TypeName.map]: fastParseMap,
  [TypeName.record]: fastParseValue,
  [TypeName.tuple]: fastParseTuple,
  [TypeName.union]: fastParseOptions,
  [TypeName.xor]: fastParseOptions,
  [TypeName.discriminatedUnion]: fastParseOptions,
  [TypeName.intersection]: fastParseOptions,
  [TypeName.object]: fastParseObject,
};

function alwaysFalse(_schema: AnySchema, _seen: Set<import("../../core/ats/index.js").AnyTypeSchema>): boolean {
  return false;
}

function fastParseLazy(schema: AnySchema, seen: Set<import("../../core/ats/index.js").AnyTypeSchema>): boolean {
  return canUseFastParse((schema.def.getter as () => import("../../core/ats/index.js").AnyTypeSchema)(), seen);
}

function fastParseWhen(schema: AnySchema, seen: Set<import("../../core/ats/index.js").AnyTypeSchema>): boolean {
  return (
    typeof schema.def.is !== "function" &&
    canUseFastParse(schema.def.thenType as import("../../core/ats/index.js").AnyTypeSchema, seen) &&
    canUseFastParse(schema.def.otherwiseType as import("../../core/ats/index.js").AnyTypeSchema, seen)
  );
}

function fastParseInner(schema: AnySchema, seen: Set<import("../../core/ats/index.js").AnyTypeSchema>): boolean {
  return canUseFastParse(schema.def.innerType as import("../../core/ats/index.js").AnyTypeSchema, seen);
}

function fastParseString(schema: AnySchema, _seen: Set<import("../../core/ats/index.js").AnyTypeSchema>): boolean {
  const checks = (schema.def.checks as readonly SchemaCheckRecord[] | undefined) ?? [];
  return !checks.some((check) => check.value instanceof RegExp && (check.value.global || check.value.sticky));
}

function fastParseElement(schema: AnySchema, seen: Set<import("../../core/ats/index.js").AnyTypeSchema>): boolean {
  return canUseFastParse(schema.def.element as import("../../core/ats/index.js").AnyTypeSchema, seen);
}

function fastParseMap(schema: AnySchema, seen: Set<import("../../core/ats/index.js").AnyTypeSchema>): boolean {
  return (
    canUseFastParse(schema.def.key as import("../../core/ats/index.js").AnyTypeSchema, seen) &&
    canUseFastParse(schema.def.value as import("../../core/ats/index.js").AnyTypeSchema, seen)
  );
}

function fastParseValue(schema: AnySchema, seen: Set<import("../../core/ats/index.js").AnyTypeSchema>): boolean {
  return canUseFastParse(schema.def.value as import("../../core/ats/index.js").AnyTypeSchema, seen);
}

function fastParseTuple(schema: AnySchema, seen: Set<import("../../core/ats/index.js").AnyTypeSchema>): boolean {
  const items = (schema.def.items as readonly import("../../core/ats/index.js").AnyTypeSchema[] | undefined) ?? [];
  const rest = schema.def.rest as import("../../core/ats/index.js").AnyTypeSchema | undefined;
  return items.every((item) => canUseFastParse(item, seen)) && (rest === undefined || canUseFastParse(rest, seen));
}

function fastParseOptions(schema: AnySchema, seen: Set<import("../../core/ats/index.js").AnyTypeSchema>): boolean {
  return (schema.def.options as readonly import("../../core/ats/index.js").AnyTypeSchema[]).every((option) =>
    canUseFastParse(option, seen)
  );
}

function fastParseObject(schema: AnySchema, seen: Set<import("../../core/ats/index.js").AnyTypeSchema>): boolean {
  const props = schema.def.props as Readonly<Record<string, import("../../core/ats/index.js").AnyTypeSchema>>;
  const catchall = schema.def.catchall as import("../../core/ats/index.js").AnyTypeSchema | undefined;
  return (
    Object.keys(props).every((key) => canUseFastParse(props[key], seen)) &&
    (catchall === undefined || canUseFastParse(catchall, seen))
  );
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
  return containedSchemas(current).some((child) => containsPromise(child, seen));
}

function containedSchemas(
  current: AnySchema & { readonly schema?: import("../../core/ats/index.js").AnyTypeSchema }
): readonly import("../../core/ats/index.js").AnyTypeSchema[] {
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
  const children = [
    def.innerType,
    def.element,
    def.key,
    def.value,
    def.input,
    def.output,
    def.thenType,
    def.otherwiseType,
    def.rest,
    ...(def.items ?? []),
    ...(def.options ?? []),
    ...Object.values(def.props ?? {}),
  ];
  return children.filter((child): child is import("../../core/ats/index.js").AnyTypeSchema => child !== undefined);
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
  return READONLY_DECISIONS[current.type]?.(current, seen) ?? false;
}

const READONLY_DECISIONS: Readonly<Record<string, SchemaDecision>> = {
  [TypeName.lazy]: (schema, seen) =>
    rootHasReadonly((schema.def.getter as () => import("../../core/ats/index.js").AnyTypeSchema)(), seen),
  [TypeName.optional]: rootHasReadonlyInner,
  [TypeName.nullable]: rootHasReadonlyInner,
  [TypeName.nullish]: rootHasReadonlyInner,
  [TypeName.default]: rootHasReadonlyInner,
  [TypeName.brand]: rootHasReadonlyInner,
  [TypeName.refine]: rootHasReadonlyInner,
  [TypeName.coerce]: rootHasReadonlyInner,
  [TypeName.pipe]: rootHasReadonlyInner,
  [TypeName.transform]: rootHasReadonlyInner,
  [TypeName.when]: (schema, seen) =>
    rootHasReadonly(schema.def.thenType as import("../../core/ats/index.js").AnyTypeSchema, seen) ||
    rootHasReadonly(schema.def.otherwiseType as import("../../core/ats/index.js").AnyTypeSchema, seen),
  [TypeName.not]: rootHasReadonlyInner,
};

function rootHasReadonlyInner(schema: AnySchema, seen: Set<import("../../core/ats/index.js").AnyTypeSchema>): boolean {
  return rootHasReadonly(schema.def.innerType as import("../../core/ats/index.js").AnyTypeSchema, seen);
}
