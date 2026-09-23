import type * as ATS from "../../core/ats/index.js";
import { TypeName } from "../../core/ats/index.js";
import { resolveWrappers } from "../resolvers/resolve-wrappers.js";

/** One normalized inclusive/exclusive bound over a scalar or cardinality. */
export interface NormalizedBound {
  readonly minimum?: number;
  readonly maximum?: number;
  readonly exact?: number;
  readonly minimumInclusive?: boolean;
  readonly maximumInclusive?: boolean;
}

/** A contradiction found while intersecting declarative constraints. */
export interface ConstraintContradiction {
  readonly code: "length_conflict" | "range_conflict";
  readonly message: string;
  readonly checks: readonly string[];
}

/** Stable semantic model used by fact inference and physical candidates. */
export interface ConstraintModel {
  readonly type: ATS.AnyTypeName;
  readonly length?: NormalizedBound;
  readonly cardinality?: NormalizedBound;
  readonly range?: NormalizedBound;
  readonly knownKeys?: readonly string[];
  readonly exactKeys?: boolean;
  readonly enumValues?: readonly (string | number)[];
  readonly literalValue?: unknown;
  readonly nullable: boolean;
  readonly optional: boolean;
  readonly nonNull: boolean;
  readonly element?: ATS.AnyTypeSchema;
  readonly primitiveElement: boolean;
  readonly stableShape: boolean;
  readonly contradictions: readonly ConstraintContradiction[];
}

/** Normalizes all order-independent checks attached to one schema node. */
export function normalizeConstraints(schema: ATS.AnyTypeSchema): ConstraintModel {
  const wrappers = resolveWrappers(schema);
  const base = wrappers.base;
  const dimension = constraintDimension(base.type);
  const normalized = mergeChecks(readChecks(base), dimension);
  const withTuple = base.type === TypeName.tuple ? mergeTupleBound(base, normalized) : normalized;
  const bound = exactify(withTuple.bound);
  const contradictions = withTuple.contradictions;

  const values = enumValues(base);
  const element = elementOf(base);
  const length = dimension === "length" ? bound : undefined;
  const cardinality = dimension === "cardinality" ? bound : undefined;
  const range = dimension === "range" ? bound : undefined;
  const model: ConstraintModel = {
    type: base.type,
    ...(length === undefined ? {} : { length }),
    ...(cardinality === undefined ? {} : { cardinality }),
    ...(range === undefined ? {} : { range }),
    ...(base.type === TypeName.object
      ? {
          knownKeys: Object.freeze(Object.keys((base.def as ATS.ObjectDef).props)),
          exactKeys: (base.def as ATS.ObjectDef).unknownKeys === "strict",
        }
      : {}),
    ...(values === undefined ? {} : { enumValues: Object.freeze(values) }),
    ...(base.type === TypeName.literal ? { literalValue: (base.def as ATS.LiteralDef).value } : {}),
    nullable: wrappers.nullable,
    optional: wrappers.optional,
    nonNull: !wrappers.nullable && !wrappers.optional,
    ...(element === undefined ? {} : { element }),
    primitiveElement: isPrimitive(element),
    stableShape: base.type === TypeName.object,
    contradictions: Object.freeze(contradictions),
  };
  return Object.freeze(model);
}

interface BoundAnalysis {
  readonly bound?: NormalizedBound;
  readonly contradictions: readonly ConstraintContradiction[];
}

function constraintDimension(type: ATS.AnyTypeName): "length" | "cardinality" | "range" | undefined {
  if (type === TypeName.string) return "length";
  if (type === TypeName.array || type === TypeName.tuple) return "cardinality";
  return isNumericType(type) ? "range" : undefined;
}

function mergeChecks(
  checks: readonly { readonly kind: string; readonly value?: unknown }[],
  dimension: "length" | "cardinality" | "range" | undefined
): BoundAnalysis {
  let bound: NormalizedBound | undefined;
  const contradictions: ConstraintContradiction[] = [];
  if (dimension === undefined) return { contradictions };

  for (const check of checks) {
    const next = boundForCheck(check, dimension);
    if (next === undefined) continue;
    const merged = mergeBound(bound, next, check.kind);
    bound = merged.bound;
    if (merged.contradiction !== undefined) contradictions.push(merged.contradiction);
  }
  return { ...(bound === undefined ? {} : { bound }), contradictions };
}

function mergeTupleBound(schema: ATS.AnyTypeSchema, analysis: BoundAnalysis): BoundAnalysis {
  const tuple = schema.def as ATS.TupleDef;
  const structuralBound: NormalizedBound =
    tuple.rest === undefined
      ? { exact: tuple.items.length, minimum: tuple.items.length, maximum: tuple.items.length }
      : { minimum: tuple.items.length };
  const merged = mergeBound(analysis.bound, structuralBound, "tuple");
  return {
    ...(merged.bound === undefined ? {} : { bound: merged.bound }),
    contradictions:
      merged.contradiction === undefined ? analysis.contradictions : [...analysis.contradictions, merged.contradiction],
  };
}

function exactify(bound: NormalizedBound | undefined): NormalizedBound | undefined {
  if (bound?.exact !== undefined || bound?.minimum === undefined || bound.minimum !== bound.maximum) return bound;
  return { ...bound, exact: bound.minimum };
}

function readChecks(schema: ATS.AnyTypeSchema): readonly { readonly kind: string; readonly value?: unknown }[] {
  const checks = (schema.def as { readonly checks?: unknown }).checks;
  return Array.isArray(checks) ? (checks as readonly { readonly kind: string; readonly value?: unknown }[]) : [];
}

function isNumericType(type: ATS.AnyTypeName): boolean {
  return type === TypeName.number || type === TypeName.int;
}

function boundForCheck(
  check: { readonly kind: string; readonly value?: unknown },
  dimension: "length" | "cardinality" | "range"
): NormalizedBound | undefined {
  switch (check.kind) {
    case "length":
      return isLengthDimension(dimension) ? exactBound(check.value) : undefined;
    case "nonEmpty":
      return isLengthDimension(dimension) ? { minimum: 1 } : undefined;
    case "min":
    case "gte":
      return minimumBound(check.value);
    case "max":
    case "lte":
      return maximumBound(check.value);
    case "moreThan":
    case "gt":
      return exclusiveMinimumBound(check.value);
    case "lessThan":
    case "lt":
      return exclusiveMaximumBound(check.value);
    default:
      return undefined;
  }
}

function isLengthDimension(dimension: "length" | "cardinality" | "range"): boolean {
  return dimension === "length" || dimension === "cardinality";
}

function exactBound(value: unknown): NormalizedBound | undefined {
  return typeof value === "number" ? { exact: value, minimum: value, maximum: value } : undefined;
}

function minimumBound(value: unknown): NormalizedBound | undefined {
  return typeof value === "number" ? { minimum: value } : undefined;
}

function maximumBound(value: unknown): NormalizedBound | undefined {
  return typeof value === "number" ? { maximum: value } : undefined;
}

function exclusiveMinimumBound(value: unknown): NormalizedBound | undefined {
  return typeof value === "number" ? { minimum: value, minimumInclusive: false } : undefined;
}

function exclusiveMaximumBound(value: unknown): NormalizedBound | undefined {
  return typeof value === "number" ? { maximum: value, maximumInclusive: false } : undefined;
}

function mergeBound(
  current: NormalizedBound | undefined,
  next: NormalizedBound,
  checkKind: string
): { readonly bound: NormalizedBound; readonly contradiction?: ConstraintContradiction } {
  if (current === undefined) return { bound: next };
  const minimum = chooseMinimum(current, next);
  const maximum = chooseMaximum(current, next);
  const exact = chooseExact(current.exact, next.exact);
  const merged = createMergedBound(minimum, maximum, exact);
  const contradiction = findContradiction(current, next, minimum, maximum, exact, checkKind);
  return { bound: Object.freeze(merged), ...(contradiction === undefined ? {} : { contradiction }) };
}

function createMergedBound(
  minimum: { readonly value: number | undefined; readonly inclusive: boolean },
  maximum: { readonly value: number | undefined; readonly inclusive: boolean },
  exact: number | undefined
): NormalizedBound {
  return {
    ...(minimum.value === undefined ? {} : { minimum: minimum.value }),
    ...(maximum.value === undefined ? {} : { maximum: maximum.value }),
    ...(exact === undefined ? {} : { exact }),
    ...(minimum.inclusive ? {} : { minimumInclusive: false }),
    ...(maximum.inclusive ? {} : { maximumInclusive: false }),
  };
}

function findContradiction(
  current: NormalizedBound,
  next: NormalizedBound,
  minimum: { readonly value: number | undefined; readonly inclusive: boolean },
  maximum: { readonly value: number | undefined; readonly inclusive: boolean },
  exact: number | undefined,
  checkKind: string
): ConstraintContradiction | undefined {
  const exactConflict = hasExactConflict(current, next);
  const exactOutside = isExactOutside(exact, minimum, maximum);
  const rangeConflict = isRangeConflict(minimum, maximum);
  if (!exactConflict && !exactOutside && !rangeConflict) return undefined;
  return {
    code: exact !== undefined ? "length_conflict" : "range_conflict",
    message: `constraint ${checkKind} makes the normalized bounds impossible`,
    checks: Object.freeze([checkKind]),
  };
}

function hasExactConflict(left: NormalizedBound, right: NormalizedBound): boolean {
  return left.exact !== undefined && right.exact !== undefined && left.exact !== right.exact;
}

function isExactOutside(
  exact: number | undefined,
  minimum: { readonly value: number | undefined; readonly inclusive: boolean },
  maximum: { readonly value: number | undefined; readonly inclusive: boolean }
): boolean {
  if (exact === undefined) return false;
  return isBelowMinimum(exact, minimum) || isAboveMaximum(exact, maximum);
}

function isBelowMinimum(
  exact: number,
  minimum: { readonly value: number | undefined; readonly inclusive: boolean }
): boolean {
  return minimum.value !== undefined && (exact < minimum.value || (exact === minimum.value && !minimum.inclusive));
}

function isAboveMaximum(
  exact: number,
  maximum: { readonly value: number | undefined; readonly inclusive: boolean }
): boolean {
  return maximum.value !== undefined && (exact > maximum.value || (exact === maximum.value && !maximum.inclusive));
}

function isRangeConflict(
  minimum: { readonly value: number | undefined; readonly inclusive: boolean },
  maximum: { readonly value: number | undefined; readonly inclusive: boolean }
): boolean {
  if (minimum.value === undefined || maximum.value === undefined) return false;
  return (
    minimum.value > maximum.value || (minimum.value === maximum.value && (!minimum.inclusive || !maximum.inclusive))
  );
}

function chooseMinimum(
  left: NormalizedBound,
  right: NormalizedBound
): { readonly value: number | undefined; readonly inclusive: boolean } {
  if (left.minimum === undefined) return { value: right.minimum, inclusive: right.minimumInclusive !== false };
  if (right.minimum === undefined) return { value: left.minimum, inclusive: left.minimumInclusive !== false };
  if (left.minimum > right.minimum) return { value: left.minimum, inclusive: left.minimumInclusive !== false };
  if (right.minimum > left.minimum) return { value: right.minimum, inclusive: right.minimumInclusive !== false };
  return {
    value: left.minimum,
    inclusive: left.minimumInclusive !== false && right.minimumInclusive !== false,
  };
}

function chooseMaximum(
  left: NormalizedBound,
  right: NormalizedBound
): { readonly value: number | undefined; readonly inclusive: boolean } {
  if (left.maximum === undefined) return { value: right.maximum, inclusive: right.maximumInclusive !== false };
  if (right.maximum === undefined) return { value: left.maximum, inclusive: left.maximumInclusive !== false };
  if (left.maximum < right.maximum) return { value: left.maximum, inclusive: left.maximumInclusive !== false };
  if (right.maximum < left.maximum) return { value: right.maximum, inclusive: right.maximumInclusive !== false };
  return {
    value: left.maximum,
    inclusive: left.maximumInclusive !== false && right.maximumInclusive !== false,
  };
}

function chooseExact(left: number | undefined, right: number | undefined): number | undefined {
  if (left === undefined) return right;
  if (right === undefined || left === right) return left;
  return left;
}

function enumValues(schema: ATS.AnyTypeSchema): readonly (string | number)[] | undefined {
  if (schema.type !== TypeName.enum) return undefined;
  const values = (schema.def as ATS.EnumDef).values;
  const raw = Array.isArray(values) ? values : Object.values(values);
  return [
    ...new Set(raw.filter((value): value is string | number => typeof value === "string" || typeof value === "number")),
  ];
}

function elementOf(schema: ATS.AnyTypeSchema): ATS.AnyTypeSchema | undefined {
  if (schema.type === TypeName.array || schema.type === TypeName.set) return (schema.def as ATS.ElementDef).element;
  return undefined;
}

function isPrimitive(schema: ATS.AnyTypeSchema | undefined): boolean {
  if (schema === undefined) return false;
  const base = resolveWrappers(schema).base;
  return (
    base.type === TypeName.string ||
    base.type === TypeName.number ||
    base.type === TypeName.int ||
    base.type === TypeName.boolean ||
    base.type === TypeName.literal ||
    base.type === TypeName.enum
  );
}
