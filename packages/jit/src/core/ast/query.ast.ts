export type QueryCompareOperator = "eq" | "neq" | "gt" | "gte" | "lt" | "lte";

export interface QueryFieldNode {
  readonly kind: "field";
  readonly key: string;
}

export interface QueryLiteralNode {
  readonly kind: "literal";
  readonly value: unknown;
}

export interface QueryBindingNode {
  readonly kind: "binding";
  readonly name: string;
}

export type QueryValueNode = QueryFieldNode | QueryLiteralNode | QueryBindingNode;

export interface QueryCompareNode {
  readonly kind: "compare";
  readonly op: QueryCompareOperator;
  readonly left: QueryValueNode;
  readonly right: QueryValueNode;
}

export interface QueryLogicalNode {
  readonly kind: "logical";
  readonly op: "and" | "or";
  readonly left: QueryConditionNode;
  readonly right: QueryConditionNode;
}

export interface QueryNotNode {
  readonly kind: "not";
  readonly inner: QueryConditionNode;
}

export type QueryConditionNode = QueryCompareNode | QueryLogicalNode | QueryNotNode;

export interface QueryFilterNode {
  readonly kind: "filter";
  readonly condition: QueryConditionNode;
}

export interface QuerySelectFieldsNode {
  readonly kind: "select:fields";
  readonly fields: readonly string[];
}

export type QuerySelectNode = QuerySelectFieldsNode;

export interface QueryUniqueNode {
  readonly kind: "unique";
  readonly key: string;
}

export interface QueryKeyedNode {
  readonly kind: "keyed";
  readonly key: string;
}

export interface QueryGroupByNode {
  readonly kind: "groupBy";
  readonly key: string;
}

export interface QueryOrderByNode {
  readonly kind: "orderBy";
  readonly key: string;
  readonly direction: "asc" | "desc";
}

export interface QueryDeleteNode {
  readonly kind: "delete";
}

export interface QueryUpdateNode {
  readonly kind: "update";
  readonly patch: Readonly<Record<string, QueryBindingNode>>;
}

export type QueryCollectorNode = QueryKeyedNode | QueryGroupByNode;

export type QueryMutationNode = QueryDeleteNode | QueryUpdateNode;

export type QueryNode =
  | QueryFilterNode
  | QuerySelectNode
  | QueryUniqueNode
  | QueryCollectorNode
  | QueryOrderByNode
  | QueryMutationNode;
