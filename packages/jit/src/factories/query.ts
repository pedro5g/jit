import { compileQuery } from "../compiler/query.js";
import type {
  QueryCompareNode,
  QueryCompareOperator,
  QueryConditionNode,
  QueryNode,
  QueryValueNode,
} from "../core/ast/index.js";
import type * as ATS from "../core/ats/index.js";
import type { SchemaInput } from "../core/builder/index.js";
import { unwrapSchema } from "../core/builder/index.js";

type CollectionElementOf<TValue> = TValue extends readonly (infer TElement)[]
  ? TElement
  : TValue extends Set<infer TElement>
    ? TElement
    : TValue extends Map<unknown, infer TElement>
      ? TElement
      : never;
type QueryCollectionKey<TValue> = Extract<keyof CollectionElementOf<TValue>, string>;
type QueryOutputKey<TValue> = Extract<keyof TValue, string>;
type QueryKeyValue<TValue, TKey extends QueryCollectionKey<TValue>> = CollectionElementOf<TValue>[TKey];
type QueryGroupKey<TValue, TKey extends QueryCollectionKey<TValue>> = Extract<QueryKeyValue<TValue, TKey>, PropertyKey>;
type QueryUpdatePatch<TValue> = {
  readonly [TKey in QueryCollectionKey<TValue>]?: CollectionElementOf<TValue>[TKey];
};
type NumericQueryKey<TValue> = {
  [TKey in QueryCollectionKey<TValue>]: CollectionElementOf<TValue>[TKey] extends number ? TKey : never;
}[QueryCollectionKey<TValue>];
type QueryPick<TValue, TKey extends keyof TValue> = {
  readonly [TField in TKey]: TValue[TField];
};
type QuerySelectResult<TResult, TSelected> =
  TResult extends Map<infer TKey, unknown>
    ? Map<TKey, TSelected>
    : TResult extends Record<infer TKey extends PropertyKey, unknown[]>
      ? Record<TKey, TSelected[]>
      : TSelected[];

/**
 * Type-safe condition factory passed to `query().filter()`.
 *
 * @template TElement - The collection element type being filtered.
 */
export interface QueryConditionBuilder<TElement> {
  eq<TKey extends Extract<keyof TElement, string>>(key: TKey, value: TElement[TKey]): QueryCompareNode;
  neq<TKey extends Extract<keyof TElement, string>>(key: TKey, value: TElement[TKey]): QueryCompareNode;
  gt<TKey extends Extract<keyof TElement, string>>(key: TKey, value: TElement[TKey]): QueryCompareNode;
  gte<TKey extends Extract<keyof TElement, string>>(key: TKey, value: TElement[TKey]): QueryCompareNode;
  lt<TKey extends Extract<keyof TElement, string>>(key: TKey, value: TElement[TKey]): QueryCompareNode;
  lte<TKey extends Extract<keyof TElement, string>>(key: TKey, value: TElement[TKey]): QueryCompareNode;
  and(left: QueryConditionNode, right: QueryConditionNode): QueryConditionNode;
  or(left: QueryConditionNode, right: QueryConditionNode): QueryConditionNode;
  not(inner: QueryConditionNode): QueryConditionNode;
}

/**
 * Fluent builder for compiled collection queries.
 *
 * @template TSchema - The collection schema type.
 * @template TOutput - The current element/result item type.
 * @template TResult - The final query result type.
 */
export interface QueryBuilder<TSchema extends ATS.AnyTypeSchema, TOutput, TResult = TOutput[]> {
  filter(
    predicate: (query: QueryConditionBuilder<CollectionElementOf<ATS.InferSchema<TSchema>>>) => QueryConditionNode
  ): QueryBuilder<TSchema, TOutput, TResult>;
  select<const TKeys extends readonly QueryOutputKey<TOutput>[]>(
    ...fields: TKeys
  ): QueryBuilder<
    TSchema,
    QueryPick<TOutput, TKeys[number]>,
    QuerySelectResult<TResult, QueryPick<TOutput, TKeys[number]>>
  >;
  unique<TKey extends QueryCollectionKey<ATS.InferSchema<TSchema>>>(key: TKey): QueryBuilder<TSchema, TOutput, TResult>;
  keyed<TKey extends QueryCollectionKey<ATS.InferSchema<TSchema>>>(
    key: TKey
  ): QueryBuilder<TSchema, TOutput, Map<QueryKeyValue<ATS.InferSchema<TSchema>, TKey>, TOutput>>;
  groupBy<TKey extends QueryCollectionKey<ATS.InferSchema<TSchema>>>(
    key: TKey
  ): QueryBuilder<TSchema, TOutput, Record<QueryGroupKey<ATS.InferSchema<TSchema>, TKey>, TOutput[]>>;
  orderBy<TKey extends QueryCollectionKey<ATS.InferSchema<TSchema>>>(
    key: TKey,
    direction?: "asc" | "desc"
  ): QueryBuilder<TSchema, TOutput, TResult>;
  delete(): QueryBuilder<TSchema, TOutput, ATS.InferSchema<TSchema>>;
  update(patch: QueryUpdatePatch<ATS.InferSchema<TSchema>>): QueryBuilder<TSchema, TOutput, ATS.InferSchema<TSchema>>;
  /** Sums a numeric field over the (filtered, unique) items; `0` when empty. */
  sum<TKey extends NumericQueryKey<ATS.InferSchema<TSchema>>>(key: TKey): QueryBuilder<TSchema, TOutput, number>;
  /** Counts the (filtered, unique) items; `0` when empty. */
  count(): QueryBuilder<TSchema, TOutput, number>;
  /** Averages a numeric field; `undefined` when no item matches. */
  avg<TKey extends NumericQueryKey<ATS.InferSchema<TSchema>>>(
    key: TKey
  ): QueryBuilder<TSchema, TOutput, number | undefined>;
  /** Minimum of a numeric field; `undefined` when no item matches. */
  min<TKey extends NumericQueryKey<ATS.InferSchema<TSchema>>>(
    key: TKey
  ): QueryBuilder<TSchema, TOutput, number | undefined>;
  /** Maximum of a numeric field; `undefined` when no item matches. */
  max<TKey extends NumericQueryKey<ATS.InferSchema<TSchema>>>(
    key: TKey
  ): QueryBuilder<TSchema, TOutput, number | undefined>;
  compile(): (value: ATS.InferSchema<TSchema>) => TResult;
}

/**
 * Creates a typed query builder for a collection schema.
 *
 * @template TSchema - The collection schema type.
 * @param schema - The schema or builder the query runs against.
 * @returns A fluent query builder that compiles to specialized JavaScript.
 */
export function query<TSchema extends ATS.AnyTypeSchema>(
  schema: SchemaInput<TSchema>
): QueryBuilder<
  TSchema,
  CollectionElementOf<ATS.InferSchema<TSchema>>,
  CollectionElementOf<ATS.InferSchema<TSchema>>[]
> {
  return createQueryBuilder(unwrapSchema(schema), [], []);
}

function createQueryBuilder<TSchema extends ATS.AnyTypeSchema, TOutput, TResult>(
  schema: TSchema,
  nodes: readonly QueryNode[],
  bindings: readonly unknown[]
): QueryBuilder<TSchema, TOutput, TResult> {
  return {
    filter(predicate) {
      const state = createConditionBuilder(bindings.length);
      const condition = predicate(
        state.builder as QueryConditionBuilder<CollectionElementOf<ATS.InferSchema<TSchema>>>
      );

      return createQueryBuilder(schema, [...nodes, { kind: "filter", condition }], [...bindings, ...state.bindings]);
    },

    select(...fields) {
      return createQueryBuilder(schema, [...nodes, { kind: "select:fields", fields }], bindings);
    },

    unique(key) {
      return createQueryBuilder(schema, [...nodes, { kind: "unique", key }], bindings);
    },

    keyed(key) {
      return createQueryBuilder(schema, [...nodes, { kind: "keyed", key }], bindings);
    },

    groupBy(key) {
      return createQueryBuilder(schema, [...nodes, { kind: "groupBy", key }], bindings);
    },

    orderBy(key, direction = "asc") {
      return createQueryBuilder(schema, [...nodes, { kind: "orderBy", key, direction }], bindings);
    },

    delete() {
      return createQueryBuilder(schema, [...nodes, { kind: "delete" }], bindings);
    },

    update(patch) {
      const state = createPatchBindings(bindings.length, patch);

      return createQueryBuilder(
        schema,
        [...nodes, { kind: "update", patch: state.patch }],
        [...bindings, ...state.bindings]
      );
    },

    sum(key) {
      return createQueryBuilder(schema, [...nodes, { kind: "aggregate", op: "sum", key }], bindings);
    },

    count() {
      return createQueryBuilder(schema, [...nodes, { kind: "aggregate", op: "count" }], bindings);
    },

    avg(key) {
      return createQueryBuilder(schema, [...nodes, { kind: "aggregate", op: "avg", key }], bindings);
    },

    min(key) {
      return createQueryBuilder(schema, [...nodes, { kind: "aggregate", op: "min", key }], bindings);
    },

    max(key) {
      return createQueryBuilder(schema, [...nodes, { kind: "aggregate", op: "max", key }], bindings);
    },

    compile() {
      return compileQuery(schema, { nodes, bindings }) as (value: ATS.InferSchema<TSchema>) => TResult;
    },
  };
}

function createPatchBindings(
  startIndex: number,
  patch: Readonly<Record<string, unknown>>
): {
  readonly patch: Readonly<Record<string, { readonly kind: "binding"; readonly name: string }>>;
  readonly bindings: readonly unknown[];
} {
  const bindings: unknown[] = [];
  const boundPatch: Record<string, { readonly kind: "binding"; readonly name: string }> = {};

  for (const key of Object.keys(patch)) {
    const index = startIndex + bindings.length;

    bindings[bindings.length] = patch[key];
    boundPatch[key] = { kind: "binding", name: `__q${index}` };
  }

  return { patch: boundPatch, bindings };
}

function createConditionBuilder(startIndex: number): {
  readonly builder: QueryConditionBuilder<unknown>;
  readonly bindings: readonly unknown[];
} {
  const bindings: unknown[] = [];
  const literal = (value: unknown): QueryValueNode => {
    const index = startIndex + bindings.length;
    bindings[bindings.length] = value;
    return { kind: "binding", name: `__q${index}` };
  };
  const compare = (op: QueryCompareOperator, key: string, value: unknown): QueryCompareNode => ({
    kind: "compare",
    op,
    left: { kind: "field", key },
    right: literal(value),
  });

  return {
    bindings,
    builder: {
      eq: (key, value) => compare("eq", key, value),
      neq: (key, value) => compare("neq", key, value),
      gt: (key, value) => compare("gt", key, value),
      gte: (key, value) => compare("gte", key, value),
      lt: (key, value) => compare("lt", key, value),
      lte: (key, value) => compare("lte", key, value),
      and: (left, right) => ({ kind: "logical", op: "and", left, right }),
      or: (left, right) => ({ kind: "logical", op: "or", left, right }),
      not: (inner) => ({ kind: "not", inner }),
    },
  };
}
