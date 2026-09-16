/** Comparison operators supported by the shared query condition AST. */
export type QueryCompareOperator = "eq" | "neq" | "gt" | "gte" | "lt" | "lte";

/** Operators supported by the shared Query AST for one inferred field value. */
export type QueryOperatorsFor<TValue> = [NonNullable<TValue>] extends [never]
  ? "eq" | "neq"
  : NonNullable<TValue> extends boolean
    ? "eq" | "neq"
    : NonNullable<TValue> extends string | number | bigint | Date
      ? QueryCompareOperator
      : never;

/** Model keys on which a particular shared Query operator is meaningful. */
export type QueryKeysForOperator<TModel, TOperator extends QueryCompareOperator> = {
  [TKey in Extract<keyof TModel, string>]-?: TOperator extends QueryOperatorsFor<TModel[TKey]> ? TKey : never;
}[Extract<keyof TModel, string>];

/** References a field on the current query row. */
export interface QueryFieldNode {
  readonly kind: "field";
  readonly key: string;
}

/** Stores a literal value in a query expression. */
export interface QueryLiteralNode {
  readonly kind: "literal";
  readonly value: unknown;
}

/** References a named value supplied by a compiled query binding. */
export interface QueryBindingNode {
  readonly kind: "binding";
  readonly name: string;
}

/** References a named parameter supplied at query execution time. */
export interface QueryParamNode {
  readonly kind: "param";
  readonly name: string;
}

/** A query value that can be a field, literal, binding, or parameter. */
export type QueryValueNode = QueryFieldNode | QueryLiteralNode | QueryBindingNode | QueryParamNode;

/** Compares two query values with a supported comparison operator. */
export interface QueryCompareNode {
  readonly kind: "compare";
  readonly op: QueryCompareOperator;
  readonly left: QueryValueNode;
  readonly right: QueryValueNode;
}

/** Combines two query conditions with short-circuiting logical semantics. */
export interface QueryLogicalNode {
  readonly kind: "logical";
  readonly op: "and" | "or";
  readonly left: QueryConditionNode;
  readonly right: QueryConditionNode;
}

/** Negates a query condition. */
export interface QueryNotNode {
  readonly kind: "not";
  readonly inner: QueryConditionNode;
}

/** A composable query predicate node. */
export type QueryConditionNode = QueryCompareNode | QueryLogicalNode | QueryNotNode;

/** Filters rows that do not satisfy its condition. */
export interface QueryFilterNode {
  readonly kind: "filter";
  readonly condition: QueryConditionNode;
}

/** Projects each row to the listed fields. */
export interface QuerySelectFieldsNode {
  readonly kind: "select:fields";
  readonly fields: readonly string[];
}

/** The field-selection form of a query projection. */
export type QuerySelectNode = QuerySelectFieldsNode;

/** Keeps one row for each unique value of a field. */
export interface QueryUniqueNode {
  readonly kind: "unique";
  readonly key: string;
}

/** Full-value or projected structural deduplication. */
export interface QueryDistinctNode {
  readonly kind: "distinct";
  /** Empty means the complete row; otherwise these fields form the key. */
  readonly fields: readonly string[];
}

/** Collects rows into a keyed result using one field. */
export interface QueryKeyedNode {
  readonly kind: "keyed";
  readonly key: string;
}

/** Collects rows into groups keyed by one field. */
export interface QueryGroupByNode {
  readonly kind: "groupBy";
  readonly key: string;
}

/** Semantic join kind. The physical planner chooses the access path. */
export type QueryJoinKind = "inner" | "left" | "semi" | "anti";

/**
 * Join semantics stored independently from the private physical strategy.
 * Schemas stay on the reconstructive artifact; the portable node names only
 * the two keys and the requested result relation.
 */
export interface QueryJoinNode {
  readonly kind: "join";
  readonly join: QueryJoinKind;
  readonly leftKey: string;
  readonly rightKey: string;
}

/** Requests ordering by one field and direction. */
export interface QueryOrderByNode {
  readonly kind: "orderBy";
  readonly key: string;
  readonly direction: "asc" | "desc";
}

/** Reduction operators supported by the query AST. */
export type QueryAggregateOperator = "sum" | "count" | "avg" | "min" | "max";

/** Reduces a collection to one aggregate value. */
export interface QueryAggregateNode {
  readonly kind: "aggregate";
  readonly op: QueryAggregateOperator;
  /** Field accumulated by the aggregate; absent for `count`. */
  readonly key?: string;
}

/** One named reduction inside a composite aggregate. */
export interface QueryAggregateField {
  readonly name: string;
  readonly op: QueryAggregateOperator;
  /** Field accumulated by the reduction; absent for `count`. */
  readonly key?: string;
}

/**
 * Several reductions over one pass. Each field keeps its own accumulator, so
 * the collection is read once no matter how many answers are asked for.
 */
export interface QueryCompositeAggregateNode {
  readonly kind: "aggregate:composite";
  readonly fields: readonly QueryAggregateField[];
}

/**
 * Reductions that answer from the loop itself and never build a result array.
 * The filters are the predicate; the terminal decides how the pass ends.
 */
export type QueryTerminalOperator = "first" | "findIndex" | "some" | "every";

/** Produces a scalar answer directly from the query loop. */
export interface QueryTerminalNode {
  readonly kind: "terminal";
  readonly op: QueryTerminalOperator;
}

/** Describes deletion of rows selected by a query. */
export interface QueryDeleteNode {
  readonly kind: "delete";
}

/** Describes a patch applied to rows selected by a query. */
export interface QueryUpdateNode {
  readonly kind: "update";
  readonly patch: Readonly<Record<string, QueryBindingNode>>;
}

/** Expands each row through the named collection field. */
export interface QueryFlatMapNode {
  readonly kind: "flatMap";
  readonly key: string;
}

/** Limits a pipeline to its first number of rows. */
export interface QueryTakeNode {
  readonly kind: "take";
  readonly count: number;
}

/** Skips a number of rows at the start of a pipeline. */
export interface QueryDropNode {
  readonly kind: "drop";
  readonly count: number;
}

/** Keeps rows until its condition first becomes false. */
export interface QueryTakeWhileNode {
  readonly kind: "takeWhile";
  readonly condition: QueryConditionNode;
}

/** Skips rows until its condition first becomes false. */
export interface QueryDropWhileNode {
  readonly kind: "dropWhile";
  readonly condition: QueryConditionNode;
}

/** Partitions a pipeline into fixed-size chunks. */
export interface QueryChunkNode {
  readonly kind: "chunk";
  readonly size: number;
}

/** Produces fixed-size rolling windows over a pipeline. */
export interface QueryWindowNode {
  readonly kind: "window";
  readonly size: number;
}

/** Pairs each row with its predecessor in the pipeline. */
export interface QueryPairwiseNode {
  readonly kind: "pairwise";
}

/** Carries an accumulator through the pipeline. */
export interface QueryScanNode {
  readonly kind: "scan";
  readonly initialBinding: string;
  readonly updateBinding: string;
}

/** Groups adjacent rows sharing a field value. */
export interface QueryGroupAdjacentNode {
  readonly kind: "groupAdjacentBy";
  readonly key: string;
}

/** A pipeline node whose result depends on ordered incremental traversal. */
export type QueryIncrementalNode =
  | QueryFlatMapNode
  | QueryTakeNode
  | QueryDropNode
  | QueryTakeWhileNode
  | QueryDropWhileNode
  | QueryChunkNode
  | QueryWindowNode
  | QueryPairwiseNode
  | QueryScanNode
  | QueryGroupAdjacentNode;

/** Any node that can participate in a query pipeline. */
export type QueryPipelineNode = QueryNode | QueryIncrementalNode;

/** A node that collects rows into keyed or grouped output. */
export type QueryCollectorNode = QueryKeyedNode | QueryGroupByNode;

/** A query mutation node that deletes or updates selected rows. */
export type QueryMutationNode = QueryDeleteNode | QueryUpdateNode;

/** A semantic query operation node. */
export type QueryNode =
  | QueryFilterNode
  | QuerySelectNode
  | QueryUniqueNode
  | QueryDistinctNode
  | QueryCollectorNode
  | QueryOrderByNode
  | QueryAggregateNode
  | QueryCompositeAggregateNode
  | QueryTerminalNode
  | QueryMutationNode;
