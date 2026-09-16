import { resolveWrappers } from "../compiler/resolvers/resolve-wrappers.js";
import type { QueryCompareOperator, QueryConditionNode, QueryPipelineNode, QueryValueNode } from "../core/ast/index.js";
import type * as ATS from "../core/ats/index.js";
import type { StandardQueryCondition, StandardQueryDefinition, StandardQueryStep, StandardQueryValue } from "./cqrs.js";

export function toStandardQuery(
  schema: ATS.AnyTypeSchema,
  program: import("../compiler/query.js").QueryProgram | undefined
): StandardQueryDefinition {
  const nodes = (program?.nodes ?? []) as readonly QueryPipelineNode[];
  let filter: StandardQueryCondition | undefined;
  let projection: readonly string[] | undefined;
  let order:
    | readonly {
        readonly path: readonly string[];
        readonly direction: "asc" | "desc";
      }[]
    | undefined;
  let limit: number | undefined;
  for (const node of nodes) {
    if (node.kind === "filter") {
      const condition = toStandardCondition(node.condition, program?.bindings ?? []);
      filter = filter
        ? Object.freeze({
            kind: "logical" as const,
            operator: "and" as const,
            left: filter,
            right: condition,
          })
        : condition;
    } else if (node.kind === "select:fields") projection = Object.freeze([...node.fields]);
    else if (node.kind === "orderBy") {
      order = Object.freeze([
        Object.freeze({
          path: Object.freeze([node.key]),
          direction: node.direction,
        }),
      ]);
    } else if (node.kind === "take") limit = limit === undefined ? node.count : Math.min(limit, node.count);
  }
  return Object.freeze({
    source: Object.freeze({
      kind: "object" as const,
      fields: Object.freeze(objectFields(schema)),
    }),
    pipeline: Object.freeze(nodes.map((node) => toStandardStep(node, program?.bindings ?? []))),
    ...(filter ? { filter } : {}),
    ...(projection ? { projection } : {}),
    ...(order ? { order } : {}),
    ...(limit === undefined ? {} : { limit }),
    params: Object.freeze([...(program?.params ?? [])]),
  });
}

function toStandardStep(node: QueryPipelineNode, bindings: readonly unknown[]): StandardQueryStep {
  switch (node.kind) {
    case "filter":
      return standardWhereStep(node, bindings);
    case "select:fields":
      return standardSelectStep(node);
    case "distinct":
      return standardDistinctStep(node);
    case "orderBy":
      return standardOrderStep(node);
    case "unique":
    case "keyed":
    case "groupBy":
    case "flatMap":
    case "groupAdjacentBy":
      return standardKeyStep(node);
    case "take":
    case "drop":
      return standardCountStep(node);
    case "takeWhile":
    case "dropWhile":
      return standardConditionStep(node, bindings);
    case "chunk":
    case "window":
      return standardSizeStep(node);
    case "pairwise":
    case "delete":
      return Object.freeze({ kind: node.kind });
    case "scan":
      return standardScanStep(node, bindings);
    case "update":
      return standardUpdateStep(node, bindings);
    case "aggregate":
      return standardAggregateStep(node);
    case "terminal":
      return Object.freeze({ kind: "terminal", operation: node.op });
    case "aggregate:composite":
      return standardCompositeAggregateStep(node);
  }
}

type KeyStepNode = Extract<
  QueryPipelineNode,
  { readonly kind: "unique" | "keyed" | "groupBy" | "flatMap" | "groupAdjacentBy" }
>;

function standardWhereStep(
  node: Extract<QueryPipelineNode, { readonly kind: "filter" }>,
  bindings: readonly unknown[]
): StandardQueryStep {
  return Object.freeze({ kind: "where", condition: toStandardCondition(node.condition, bindings) });
}

function standardSelectStep(node: Extract<QueryPipelineNode, { readonly kind: "select:fields" }>): StandardQueryStep {
  return Object.freeze({ kind: "select", fields: Object.freeze([...node.fields]) });
}

function standardDistinctStep(node: Extract<QueryPipelineNode, { readonly kind: "distinct" }>): StandardQueryStep {
  return Object.freeze({ kind: "distinct", fields: Object.freeze([...node.fields]) });
}

function standardOrderStep(node: Extract<QueryPipelineNode, { readonly kind: "orderBy" }>): StandardQueryStep {
  return Object.freeze({ kind: "orderBy", key: node.key, direction: node.direction });
}

function standardKeyStep(node: KeyStepNode): StandardQueryStep {
  return Object.freeze({ kind: node.kind, key: node.key });
}

function standardCountStep(node: Extract<QueryPipelineNode, { readonly kind: "take" | "drop" }>): StandardQueryStep {
  return Object.freeze({ kind: node.kind, count: node.count });
}

function standardConditionStep(
  node: Extract<QueryPipelineNode, { readonly kind: "takeWhile" | "dropWhile" }>,
  bindings: readonly unknown[]
): StandardQueryStep {
  return Object.freeze({ kind: node.kind, condition: toStandardCondition(node.condition, bindings) });
}

function standardSizeStep(node: Extract<QueryPipelineNode, { readonly kind: "chunk" | "window" }>): StandardQueryStep {
  return Object.freeze({ kind: node.kind, size: node.size });
}

function standardScanStep(
  node: Extract<QueryPipelineNode, { readonly kind: "scan" }>,
  bindings: readonly unknown[]
): StandardQueryStep {
  return Object.freeze({
    kind: "scan",
    initial: toStandardValue({ kind: "binding", name: node.initialBinding }, bindings),
    update: Object.freeze({ kind: "binding" as const, name: node.updateBinding }),
  });
}

function standardUpdateStep(
  node: Extract<QueryPipelineNode, { readonly kind: "update" }>,
  bindings: readonly unknown[]
): StandardQueryStep {
  return Object.freeze({
    kind: "update",
    patch: Object.freeze(
      Object.fromEntries(Object.entries(node.patch).map(([key, value]) => [key, toStandardValue(value, bindings)]))
    ),
  });
}

function standardAggregateStep(node: Extract<QueryPipelineNode, { readonly kind: "aggregate" }>): StandardQueryStep {
  return Object.freeze({ kind: "aggregate", operation: node.op, ...(node.key === undefined ? {} : { key: node.key }) });
}

function standardCompositeAggregateStep(
  node: Extract<QueryPipelineNode, { readonly kind: "aggregate:composite" }>
): StandardQueryStep {
  return Object.freeze({
    kind: "aggregate:composite",
    fields: Object.freeze(
      node.fields.map((field) =>
        Object.freeze({ name: field.name, operation: field.op, ...(field.key === undefined ? {} : { key: field.key }) })
      )
    ),
  });
}

export function objectFields(schema: ATS.AnyTypeSchema): string[] {
  const object = schema.type === "runtimeType" ? (schema.def as ATS.RuntimeTypeDef).innerType : schema;
  return object.type === "object" ? Object.keys((object.def as ATS.ObjectDef).props) : [];
}

export function schemaAtPath(schema: ATS.AnyTypeSchema, path: string): ATS.AnyTypeSchema | undefined {
  let current = schema;
  for (const key of path.split(".")) {
    current = resolveWrappers(current).base;
    if (current.type !== "object") return undefined;
    const next = (current.def as ATS.ObjectDef).props[key];
    if (!next) return undefined;
    current = next;
  }
  return resolveWrappers(current).base;
}

const EQUALITY_QUERY_OPERATORS = Object.freeze(["eq", "neq"] satisfies readonly QueryCompareOperator[]);
const ORDERED_QUERY_OPERATORS = Object.freeze([
  "eq",
  "neq",
  "gt",
  "gte",
  "lt",
  "lte",
] satisfies readonly QueryCompareOperator[]);

export function queryOperatorsForSchema(schema: ATS.AnyTypeSchema): readonly QueryCompareOperator[] {
  const base = resolveWrappers(schema).base;
  if (base.type === "boolean" || base.type === "null" || base.type === "undefined") return EQUALITY_QUERY_OPERATORS;
  if (["string", "number", "int", "bigint", "date", "templateLiteral", "enum"].includes(base.type)) {
    return ORDERED_QUERY_OPERATORS;
  }
  if (base.type === "literal") {
    const value = (base.def as ATS.LiteralDef).value;
    return typeof value === "boolean" || value === null ? EQUALITY_QUERY_OPERATORS : ORDERED_QUERY_OPERATORS;
  }
  return Object.freeze([]);
}

function toStandardCondition(condition: QueryConditionNode, bindings: readonly unknown[]): StandardQueryCondition {
  if (condition.kind === "compare") {
    return Object.freeze({
      kind: "compare" as const,
      operator: condition.op,
      left: toStandardValue(condition.left, bindings),
      right: toStandardValue(condition.right, bindings),
    });
  }
  if (condition.kind === "logical") {
    return Object.freeze({
      kind: "logical" as const,
      operator: condition.op,
      left: toStandardCondition(condition.left, bindings),
      right: toStandardCondition(condition.right, bindings),
    });
  }
  return Object.freeze({
    kind: "not" as const,
    inner: toStandardCondition(condition.inner, bindings),
  });
}

function toStandardValue(value: QueryValueNode, bindings: readonly unknown[]): StandardQueryValue {
  if (value.kind === "field")
    return Object.freeze({
      kind: "field" as const,
      path: Object.freeze([value.key]),
    });
  if (value.kind === "literal") return Object.freeze({ kind: "literal" as const, value: value.value });
  if (value.kind === "binding") {
    const index = Number.parseInt(value.name.slice(3), 10);
    if (Number.isSafeInteger(index) && index >= 0 && index < bindings.length && isStandardData(bindings[index])) {
      return Object.freeze({
        kind: "literal" as const,
        value: bindings[index],
      });
    }
    return Object.freeze({ kind: "binding" as const, name: value.name });
  }
  return Object.freeze({ kind: "param" as const, name: value.name });
}

function isStandardData(value: unknown, seen = new Set<object>()): boolean {
  if (value === null) return true;
  if (["string", "number", "bigint", "boolean", "undefined"].includes(typeof value)) return true;
  if (typeof value !== "object" || seen.has(value)) return false;
  seen.add(value);
  if (Array.isArray(value)) return value.every((item) => isStandardData(item, seen));
  if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) return false;
  return Object.values(value).every((item) => isStandardData(item, seen));
}
