import type { QueryConditionNode, QueryNode, QueryUpdateNode, QueryValueNode } from "../core/ast/index.js";

/** Formats the stable structural key used by query compilation caches. */
export function serializeQueryNodes(
  nodes: readonly QueryNode[],
  serializeUpdate: (node: QueryUpdateNode) => string = (node) => `m(${Object.keys(node.patch).join(",")})`
): string {
  return nodes.map((node) => serializeQueryNode(node, serializeUpdate)).join(";");
}

/** Serializes update bindings without including their runtime values in a cache key. */
export function serializeQueryUpdateNode(node: QueryUpdateNode): string {
  return `m(${Object.keys(node.patch)
    .map((key) => `${key}=${node.patch[key]?.name}`)
    .join(",")})`;
}

function serializeQueryNode(node: QueryNode, serializeUpdate: (node: QueryUpdateNode) => string): string {
  switch (node.kind) {
    case "filter":
      return `f(${serializeCondition(node.condition)})`;
    case "select:fields":
      return `s(${node.fields.join(",")})`;
    case "aggregate":
      return `a(${node.op},${node.key ?? ""})`;
    case "terminal":
      return `t(${node.op})`;
    case "aggregate:composite":
      return `A(${node.fields.map((field) => `${field.name}:${field.op}:${field.key ?? ""}`).join(",")})`;
    case "unique":
      return `u(${node.key})`;
    case "distinct":
      return `D(${node.fields.join(",")})`;
    case "keyed":
      return `k(${node.key})`;
    case "groupBy":
      return `g(${node.key})`;
    case "orderBy":
      return `o(${node.key},${node.direction})`;
    case "delete":
      return "d()";
    case "update":
      return serializeUpdate(node);
  }
}

function serializeCondition(condition: QueryConditionNode): string {
  switch (condition.kind) {
    case "compare":
      return `${condition.op}(${serializeValue(condition.left)},${serializeValue(condition.right)})`;
    case "logical":
      return `${condition.op}(${serializeCondition(condition.left)},${serializeCondition(condition.right)})`;
    case "not":
      return `not(${serializeCondition(condition.inner)})`;
  }
}

function serializeValue(value: QueryValueNode): string {
  switch (value.kind) {
    case "field":
      return `.${value.key}`;
    case "binding":
      return `$${value.name}`;
    case "param":
      return `p:${value.name}`;
    case "literal":
      return `#${typeof value.value}:${String(value.value)}`;
  }
}
