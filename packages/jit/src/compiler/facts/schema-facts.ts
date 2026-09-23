import type * as ATS from "../../core/ats/index.js";
import { TypeName } from "../../core/ats/index.js";
import { resolveHints } from "../../core/hints/index.js";
import { resolveWrappers } from "../resolvers/resolve-wrappers.js";
import { schemaChildren } from "../schema-recursion.js";
import { normalizeConstraints } from "./constraint-model.js";

/** Semantic facts are proofs about the contract, never emitter preferences. */
export type SemanticFactKind =
  | "IsString"
  | "IsNumber"
  | "IsInteger"
  | "IsBoolean"
  | "IsObject"
  | "NonNull"
  | "Nullable"
  | "Optional"
  | "KnownShape"
  | "KnownKeys"
  | "ExactKeys"
  | "KnownField"
  | "ExactLength"
  | "MinLength"
  | "MaxLength"
  | "ExactCardinality"
  | "MinCardinality"
  | "MaxCardinality"
  | "EnumValues"
  | "EnumCardinality"
  | "LiteralValue"
  | "PrimitiveElement"
  | "KnownElementType"
  | "UniqueBy"
  | "IndexedBy"
  | "OrderedBy"
  | "HashedBy"
  | "StableShape"
  | "MonomorphicShape"
  | "Validated"
  | "Sanitized"
  | "Range";

/** One normalized semantic proof at a stable schema path. */
export interface SemanticFact {
  readonly kind: SemanticFactKind;
  readonly path: readonly string[];
  readonly minimum?: number;
  readonly maximum?: number;
  readonly exact?: number;
  readonly values?: readonly (string | number)[];
  readonly value?: unknown;
  readonly elementType?: string;
}

/** Derives deterministic facts from the normalized model. */
export function deriveSchemaFacts(schema: ATS.AnyTypeSchema, path: readonly string[] = []): SemanticFact[] {
  return deriveSchemaFactsInternal(schema, path, new Set<ATS.AnyTypeSchema>());
}

function deriveSchemaFactsInternal(
  schema: ATS.AnyTypeSchema,
  path: readonly string[],
  seen: Set<ATS.AnyTypeSchema>
): SemanticFact[] {
  const { base, optional, nullable } = resolveWrappers(schema);
  if (seen.has(base)) return [];
  seen.add(base);
  const model = normalizeConstraints(schema);
  const hints = resolveHints(schema);
  const facts = deriveTypeFacts(base, model, path, seen);

  if (optional) facts.push(fact("Optional", path));
  if (nullable) facts.push(fact("Nullable", path));
  if (!optional && !nullable && base.type !== TypeName.object) facts.push(fact("NonNull", path));
  appendHintFacts(facts, hints, path);
  addBoundFacts(facts, model.length, "Length", path);
  addBoundFacts(facts, model.cardinality, "Cardinality", path);
  appendRangeFact(facts, model.range, path);
  appendGenericChildren(facts, base, path, seen);
  seen.delete(base);
  return facts;
}

function deriveTypeFacts(
  schema: ATS.AnyTypeSchema,
  model: ReturnType<typeof normalizeConstraints>,
  path: readonly string[],
  seen: Set<ATS.AnyTypeSchema>
): SemanticFact[] {
  switch (schema.type) {
    case TypeName.string:
      return [fact("IsString", path)];
    case TypeName.number:
      return [fact("IsNumber", path)];
    case TypeName.int:
      return [fact("IsNumber", path), fact("IsInteger", path)];
    case TypeName.boolean:
      return [fact("IsBoolean", path)];
    case TypeName.object:
      return deriveObjectFacts(schema, model, path, seen);
    case TypeName.array:
      return deriveArrayFacts(model, path, seen);
    case TypeName.tuple:
      return deriveTupleFacts(schema, path, seen);
    case TypeName.enum:
      return deriveEnumFacts(model, path);
    case TypeName.literal:
      return [factWith("LiteralValue", path, { value: model.literalValue })];
    default:
      return [];
  }
}

function deriveObjectFacts(
  schema: ATS.AnyTypeSchema,
  model: ReturnType<typeof normalizeConstraints>,
  path: readonly string[],
  seen: Set<ATS.AnyTypeSchema>
): SemanticFact[] {
  const props = (schema.def as ATS.ObjectDef).props;
  const facts = [fact("IsObject", path), fact("NonNull", path), fact("KnownShape", path), fact("StableShape", path)];
  facts.push(factWith("KnownKeys", path, { values: model.knownKeys ?? [] }));
  if (model.exactKeys) facts.push(fact("ExactKeys", path), fact("MonomorphicShape", path));
  for (const key of model.knownKeys ?? []) {
    const childPath = [...path, key];
    facts.push(fact("KnownField", childPath), ...deriveSchemaFactsInternal(props[key], childPath, seen));
  }
  return facts;
}

function deriveArrayFacts(
  model: ReturnType<typeof normalizeConstraints>,
  path: readonly string[],
  seen: Set<ATS.AnyTypeSchema>
): SemanticFact[] {
  const facts: SemanticFact[] = model.primitiveElement ? [fact("PrimitiveElement", path)] : [];
  if (model.element !== undefined) {
    facts.push(
      factWith("KnownElementType", path, { elementType: model.element.type }),
      ...deriveSchemaFactsInternal(model.element, [...path, "element"], seen)
    );
  }
  return facts;
}

function deriveTupleFacts(
  schema: ATS.AnyTypeSchema,
  path: readonly string[],
  seen: Set<ATS.AnyTypeSchema>
): SemanticFact[] {
  const facts: SemanticFact[] = [];
  for (const [index, child] of schemaChildren(schema).entries()) {
    facts.push(...deriveSchemaFactsInternal(child, [...path, String(index)], seen));
  }
  return facts;
}

function deriveEnumFacts(model: ReturnType<typeof normalizeConstraints>, path: readonly string[]): SemanticFact[] {
  if (model.enumValues === undefined) return [];
  return [
    factWith("EnumValues", path, { values: model.enumValues }),
    factWith("EnumCardinality", path, { exact: model.enumValues.length }),
  ];
}

function appendRangeFact(
  facts: SemanticFact[],
  range: ReturnType<typeof normalizeConstraints>["range"],
  path: readonly string[]
): void {
  if (range === undefined) return;
  facts.push(
    Object.freeze({
      kind: "Range",
      path: Object.freeze([...path]),
      ...(range.minimum === undefined ? {} : { minimum: range.minimum }),
      ...(range.maximum === undefined ? {} : { maximum: range.maximum }),
    })
  );
}

function appendGenericChildren(
  facts: SemanticFact[],
  schema: ATS.AnyTypeSchema,
  path: readonly string[],
  seen: Set<ATS.AnyTypeSchema>
): void {
  if (isSpecializedNode(schema.type)) return;
  for (const [index, child] of schemaChildren(schema).entries()) {
    facts.push(...deriveSchemaFactsInternal(child, [...path, `$${index}`], seen));
  }
}

function isSpecializedNode(type: ATS.AnyTypeName): boolean {
  return (
    type === TypeName.object ||
    type === TypeName.array ||
    type === TypeName.tuple ||
    type === TypeName.enum ||
    type === TypeName.literal
  );
}

function addBoundFacts(
  facts: SemanticFact[],
  bound: { readonly minimum?: number; readonly maximum?: number; readonly exact?: number } | undefined,
  dimension: "Length" | "Cardinality",
  path: readonly string[]
): void {
  if (bound === undefined) return;
  if (bound.exact !== undefined && Number.isFinite(bound.exact))
    facts.push(factWith(`Exact${dimension}`, path, { exact: bound.exact }));
  else {
    if (bound.minimum !== undefined) facts.push(factWith(`Min${dimension}`, path, { minimum: bound.minimum }));
    if (bound.maximum !== undefined) facts.push(factWith(`Max${dimension}`, path, { maximum: bound.maximum }));
  }
}

function fact(kind: SemanticFactKind, path: readonly string[] = []): SemanticFact {
  return Object.freeze({ kind, path: Object.freeze([...path]) });
}

function factWith(
  kind: SemanticFactKind,
  path: readonly string[],
  fields: Readonly<Partial<Omit<SemanticFact, "kind" | "path">>>
): SemanticFact {
  return Object.freeze({ ...fact(kind, path), ...fields });
}

function appendHintFacts(facts: SemanticFact[], hints: ReturnType<typeof resolveHints>, path: readonly string[]): void {
  const collection = hints.collection;
  if (typeof collection?.uniqueBy === "string") facts.push(factWith("UniqueBy", path, { value: collection.uniqueBy }));
  if (collection?.indexed === true && typeof collection.identify === "string") {
    facts.push(factWith("IndexedBy", path, { value: collection.identify }));
  }
  const ordered = collection?.ordered ?? hints.order;
  if (typeof ordered?.key === "string") facts.push(factWith("OrderedBy", path, { value: ordered.key }));
  if (hints.hash?.strategy !== undefined) facts.push(factWith("HashedBy", path, { value: hints.hash.strategy }));
}
