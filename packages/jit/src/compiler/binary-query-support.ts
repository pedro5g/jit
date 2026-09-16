import type { QueryConditionNode, QueryNode, QueryValueNode } from "../core/ast/index.js";
import type { BinaryRowLayout } from "./binary-rowset.js";

export function serializeQueryNodes(nodes: readonly QueryNode[]): string {
  return nodes.map(serializeQueryNode).join(";");
}

export function serializeBinaryLayout(layout: BinaryRowLayout): string {
  return JSON.stringify([
    layout.memoryLayout,
    layout.rowSize,
    layout.maskBytes,
    layout.union
      ? [layout.union.discriminator, layout.union.variants.map((variant) => [variant.tag, variant.value, variant.keys])]
      : undefined,
    layout.fields.map((field) => [
      field.key,
      field.kind,
      field.offset,
      field.size,
      field.access,
      field.columnIndex,
      field.guard?.maskOffset,
      field.guard?.shift,
    ]),
  ]);
}

function serializeQueryNode(node: QueryNode): string {
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
      return `m(${Object.keys(node.patch).join(",")})`;
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
