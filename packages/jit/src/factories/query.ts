import {
  type BinaryArray,
  type BinaryRowSet,
  compileBinaryQuery,
  emitBinaryQuerySource,
  isBinaryArray,
  isBinaryRowSet,
} from "../compiler/binary-rowset.js";
import {
  compileQueryArray,
  compileQueryAsyncIterator,
  compileQueryIterator,
  compileQueryVisitor,
  explainQueryExecution,
  type QueryAsyncIteratorCompiled,
  type QueryExecutionPlan,
  type QueryIteratorCompiled,
  type QueryVisitorCompiled,
} from "../compiler/lazy-query.js";
import {
  compileQuery,
  expectCollectionObjectSchema,
  explainPhysicalQuery,
  type QueryProgram,
} from "../compiler/query.js";
import type {
  QueryAggregateOperator,
  QueryCompareNode,
  QueryCompareOperator,
  QueryConditionNode,
  QueryNode,
  QueryPipelineNode,
  QueryValueNode,
} from "../core/ast/index.js";
import type * as ATS from "../core/ats/index.js";
import type { SchemaInput } from "../core/builder/index.js";
import { unwrapSchema } from "../core/builder/index.js";
import { JITError } from "../errors/index.js";
import { registerArtifact } from "../runtime/artifact-registry.js";

const QUERY_PROGRAMS = new WeakMap<object, QueryProgram>();

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
type ParamSchemaShape = Readonly<Record<string, SchemaInput>>;
type TypeofParamShape<TShape extends ParamSchemaShape> = {
  readonly [TKey in keyof TShape]: TShape[TKey] extends SchemaInput<infer TSchema> ? ATS.TypeofSchema<TSchema> : never;
};
type QueryComparable<TValue> = TValue | QueryConstRef<TValue> | QueryParamRef;
export type QueryRuntimeParams<TParams extends Readonly<Record<string, unknown>>> = {
  readonly [TKey in keyof TParams]: QueryParamRef<TParams[TKey]>;
};
/**
 * Running a query is a plain call. `params` stays optional in the signature
 * because the builder is generic over its own parameter shape while it is
 * still being assembled; a declared shape is still checked structurally.
 */
type QueryCompiledFunction<
  TSchema extends ATS.AnyTypeSchema,
  TResult,
  TParams extends Readonly<Record<string, unknown>>,
> = (value: ATS.TypeofSchema<TSchema>, params?: TParams) => TResult;
type BinaryQueryCompiledFunction<TElement, TResult, TParams extends Readonly<Record<string, unknown>>> = (
  value: BinaryRowSet<TElement>,
  params?: TParams
) => TResult;
type QuerySelectResult<TResult, TSelected> =
  TResult extends Map<infer TKey, unknown>
    ? Map<TKey, TSelected>
    : TResult extends Record<infer TKey extends PropertyKey, unknown[]>
      ? Record<TKey, TSelected[]>
      : TSelected[];
type IterableElement<TValue> = TValue extends Iterable<infer TElement> ? TElement : never;

/**
 * Type-safe condition factory passed to `query().filter()`.
 *
 * @template TElement - The collection element type being filtered.
 */
export interface QueryConditionBuilder<TElement> {
  eq<TKey extends Extract<keyof TElement, string>>(key: TKey, value: QueryComparable<TElement[TKey]>): QueryCompareNode;
  neq<TKey extends Extract<keyof TElement, string>>(
    key: TKey,
    value: QueryComparable<TElement[TKey]>
  ): QueryCompareNode;
  gt<TKey extends Extract<keyof TElement, string>>(key: TKey, value: QueryComparable<TElement[TKey]>): QueryCompareNode;
  gte<TKey extends Extract<keyof TElement, string>>(
    key: TKey,
    value: QueryComparable<TElement[TKey]>
  ): QueryCompareNode;
  lt<TKey extends Extract<keyof TElement, string>>(key: TKey, value: QueryComparable<TElement[TKey]>): QueryCompareNode;
  lte<TKey extends Extract<keyof TElement, string>>(
    key: TKey,
    value: QueryComparable<TElement[TKey]>
  ): QueryCompareNode;
  constant<const TValue extends string | number | bigint | boolean | null | undefined>(
    value: TValue
  ): QueryConstRef<TValue>;
  /** Folds two or more conditions into one nested `and` chain. */
  and(left: QueryConditionNode, right: QueryConditionNode, ...rest: readonly QueryConditionNode[]): QueryConditionNode;
  /** Folds two or more conditions into one nested `or` chain. */
  or(left: QueryConditionNode, right: QueryConditionNode, ...rest: readonly QueryConditionNode[]): QueryConditionNode;
  not(inner: QueryConditionNode): QueryConditionNode;
}

/**
 * Fluent builder for compiled collection queries.
 *
 * @template TSchema - The collection schema type.
 * @template TOutput - The current element/result item type.
 * @template TResult - The final query result type.
 */
export type QueryBuilder<
  TSchema extends ATS.AnyTypeSchema,
  TOutput,
  TResult = TOutput[],
  TParams extends Readonly<Record<string, unknown>> = Readonly<Record<never, never>>,
> = QueryCompiledFunction<TSchema, TResult, TParams> & QueryBuilderOps<TSchema, TOutput, TResult, TParams>;

/** Chain operators carried by every query builder; the builder itself runs the query. */
export interface QueryBuilderOps<
  TSchema extends ATS.AnyTypeSchema,
  TOutput,
  TResult = TOutput[],
  TParams extends Readonly<Record<string, unknown>> = Readonly<Record<never, never>>,
> {
  params<const TShape extends ParamSchemaShape>(
    shape: TShape
  ): QueryBuilder<TSchema, TOutput, TResult, TParams & TypeofParamShape<TShape>>;
  filter(
    predicate: (
      query: QueryConditionBuilder<CollectionElementOf<ATS.TypeofSchema<TSchema>>>,
      params: QueryRuntimeParams<TParams>
    ) => QueryConditionNode
  ): QueryBuilder<TSchema, TOutput, TResult, TParams>;
  select<const TKeys extends readonly QueryOutputKey<TOutput>[]>(
    ...fields: TKeys
  ): QueryBuilder<
    TSchema,
    QueryPick<TOutput, TKeys[number]>,
    QuerySelectResult<TResult, QueryPick<TOutput, TKeys[number]>>,
    TParams
  >;
  unique<TKey extends QueryCollectionKey<ATS.TypeofSchema<TSchema>>>(
    key: TKey
  ): QueryBuilder<TSchema, TOutput, TResult, TParams>;
  /** Keeps the first structurally distinct row, or first distinct projected key. */
  distinct<const TKeys extends readonly QueryCollectionKey<ATS.TypeofSchema<TSchema>>[]>(
    ...fields: TKeys
  ): QueryBuilder<TSchema, TOutput, TResult, TParams>;
  keyed<TKey extends QueryCollectionKey<ATS.TypeofSchema<TSchema>>>(
    key: TKey
  ): QueryBuilder<TSchema, TOutput, Map<QueryKeyValue<ATS.TypeofSchema<TSchema>, TKey>, TOutput>, TParams>;
  groupBy<TKey extends QueryCollectionKey<ATS.TypeofSchema<TSchema>>>(
    key: TKey
  ): QueryBuilder<TSchema, TOutput, Record<QueryGroupKey<ATS.TypeofSchema<TSchema>, TKey>, TOutput[]>, TParams>;
  orderBy<TKey extends QueryCollectionKey<ATS.TypeofSchema<TSchema>>>(
    key: TKey,
    direction?: "asc" | "desc"
  ): QueryBuilder<TSchema, TOutput, TResult, TParams>;
  flatMap<TKey extends Extract<keyof TOutput, string>>(
    key: TKey
  ): QueryBuilder<TSchema, IterableElement<TOutput[TKey]>, IterableElement<TOutput[TKey]>[], TParams>;
  take(count: number): QueryBuilder<TSchema, TOutput, TResult, TParams>;
  drop(count: number): QueryBuilder<TSchema, TOutput, TResult, TParams>;
  takeWhile(
    predicate: (
      query: QueryConditionBuilder<CollectionElementOf<ATS.TypeofSchema<TSchema>>>,
      params: QueryRuntimeParams<TParams>
    ) => QueryConditionNode
  ): QueryBuilder<TSchema, TOutput, TResult, TParams>;
  dropWhile(
    predicate: (
      query: QueryConditionBuilder<CollectionElementOf<ATS.TypeofSchema<TSchema>>>,
      params: QueryRuntimeParams<TParams>
    ) => QueryConditionNode
  ): QueryBuilder<TSchema, TOutput, TResult, TParams>;
  chunk(size: number): QueryBuilder<TSchema, TOutput[], TOutput[][], TParams>;
  window(size: number): QueryBuilder<TSchema, TOutput[], TOutput[][], TParams>;
  pairwise(): QueryBuilder<TSchema, readonly [TOutput, TOutput], (readonly [TOutput, TOutput])[], TParams>;
  scan<TAccumulator>(options: {
    readonly initial: TAccumulator;
    readonly update: (accumulator: TAccumulator, value: TOutput) => TAccumulator | Promise<TAccumulator>;
  }): QueryBuilder<TSchema, TAccumulator, TAccumulator[], TParams>;
  groupAdjacentBy<TKey extends Extract<keyof TOutput, string>>(
    key: TKey
  ): QueryBuilder<TSchema, TOutput[], TOutput[][], TParams>;
  delete(): QueryBuilder<TSchema, TOutput, ATS.TypeofSchema<TSchema>, TParams>;
  update(
    patch: QueryUpdatePatch<ATS.TypeofSchema<TSchema>>
  ): QueryBuilder<TSchema, TOutput, ATS.TypeofSchema<TSchema>, TParams>;
  /** Sums a numeric field over the (filtered, unique) items; `0` when empty. */
  sum<TKey extends NumericQueryKey<ATS.TypeofSchema<TSchema>>>(
    key: TKey
  ): QueryBuilder<TSchema, TOutput, number, TParams>;
  /** Counts the (filtered, unique) items; `0` when empty. */
  count(): QueryBuilder<TSchema, TOutput, number, TParams>;
  /** Averages a numeric field; `undefined` when no item matches. */
  avg<TKey extends NumericQueryKey<ATS.TypeofSchema<TSchema>>>(
    key: TKey
  ): QueryBuilder<TSchema, TOutput, number | undefined, TParams>;
  /** Minimum of a numeric field; `undefined` when no item matches. */
  min<TKey extends NumericQueryKey<ATS.TypeofSchema<TSchema>>>(
    key: TKey
  ): QueryBuilder<TSchema, TOutput, number | undefined, TParams>;
  /** Maximum of a numeric field; `undefined` when no item matches. */
  max<TKey extends NumericQueryKey<ATS.TypeofSchema<TSchema>>>(
    key: TKey
  ): QueryBuilder<TSchema, TOutput, number | undefined, TParams>;
  /**
   * Several reductions over one pass, each with its own accumulator. Asking
   * for four answers still reads the collection once.
   */
  aggregate(
    spec: Readonly<Record<string, { readonly op: QueryAggregateOperator; readonly key?: string }>>
  ): QueryBuilder<TSchema, TOutput, Readonly<Record<string, number | undefined>>, TParams>;
  /**
   * Returns the first matching item, or `undefined`. Returns from inside the
   * loop: nothing is collected and the rest of the collection is not read.
   */
  first(): QueryBuilder<TSchema, TOutput, TOutput | undefined, TParams>;
  /** Index of the first matching item in the input, or `-1`. */
  findIndex(): QueryBuilder<TSchema, TOutput, number, TParams>;
  /** True as soon as one item matches; stops there. */
  some(): QueryBuilder<TSchema, TOutput, boolean, TParams>;
  /** True when every item matches; stops at the first that does not. */
  every(): QueryBuilder<TSchema, TOutput, boolean, TParams>;
  /** Alternative result shapes for the same query program. */
  readonly to: QuerySinks<TSchema, TOutput, TParams>;
  lazy(): LazyQueryBuilder<TSchema, TOutput, TParams>;
  explain(outputMode?: "eager-array" | "generator" | "async-generator" | "visitor"): QueryExecutionPlan;
}

export interface QuerySinks<
  TSchema extends ATS.AnyTypeSchema,
  TOutput,
  TParams extends Readonly<Record<string, unknown>>,
> {
  /** Streams results, materializing nothing. */
  iterator(): QueryIteratorCompiled<CollectionElementOf<ATS.TypeofSchema<TSchema>>, TOutput, TParams>;
  asyncIterator(): QueryAsyncIteratorCompiled<CollectionElementOf<ATS.TypeofSchema<TSchema>>, TOutput, TParams>;
  /** Pushes each result into a callback; no array and no generator frames. */
  visitor(): QueryVisitorCompiled<CollectionElementOf<ATS.TypeofSchema<TSchema>>, TOutput, TParams>;
}

/** A lazy query is the generator itself; sinks reshape the same program. */
export type LazyQueryBuilder<
  TSchema extends ATS.AnyTypeSchema,
  TOutput,
  TParams extends Readonly<Record<string, unknown>> = Readonly<Record<never, never>>,
> = QueryIteratorCompiled<CollectionElementOf<ATS.TypeofSchema<TSchema>>, TOutput, TParams> & {
  readonly to: Omit<QuerySinks<TSchema, TOutput, TParams>, "iterator">;
  explain(outputMode?: "generator" | "async-generator" | "visitor"): QueryExecutionPlan;
};

/**
 * Query builder backed by a binary rowset layout. It accepts the same filter
 * AST as regular `JIT.query`, but compiles supported filters/projections into
 * byte-offset scans over `ArrayBuffer` rows.
 */
export type BinaryQueryBuilder<
  TElement,
  TOutput,
  TResult = TOutput[],
  TParams extends Readonly<Record<string, unknown>> = Readonly<Record<never, never>>,
> = BinaryQueryCompiledFunction<TElement, TResult, TParams> &
  BinaryQueryBuilderOps<TElement, TOutput, TResult, TParams>;

export interface BinaryQueryBuilderOps<
  TElement,
  TOutput,
  TResult = TOutput[],
  TParams extends Readonly<Record<string, unknown>> = Readonly<Record<never, never>>,
> {
  params<const TShape extends ParamSchemaShape>(
    shape: TShape
  ): BinaryQueryBuilder<TElement, TOutput, TResult, TParams & TypeofParamShape<TShape>>;
  filter(
    predicate: (query: QueryConditionBuilder<TElement>, params: QueryRuntimeParams<TParams>) => QueryConditionNode
  ): BinaryQueryBuilder<TElement, TOutput, TResult, TParams>;
  select<const TKeys extends readonly Extract<keyof TOutput, string>[]>(
    ...fields: TKeys
  ): BinaryQueryBuilder<TElement, QueryPick<TOutput, TKeys[number]>, QueryPick<TOutput, TKeys[number]>[], TParams>;
  /** Sums a numeric field over the filtered rowset. */
  sum<TKey extends Extract<keyof TElement, string>>(key: TKey): BinaryQueryBuilder<TElement, TOutput, number, TParams>;
  /** Counts filtered rows. */
  count(): BinaryQueryBuilder<TElement, TOutput, number, TParams>;
  /** Averages a numeric field; `undefined` when no row matches. */
  avg<TKey extends Extract<keyof TElement, string>>(
    key: TKey
  ): BinaryQueryBuilder<TElement, TOutput, number | undefined, TParams>;
  /** Minimum of a numeric field; `undefined` when no row matches. */
  min<TKey extends Extract<keyof TElement, string>>(
    key: TKey
  ): BinaryQueryBuilder<TElement, TOutput, number | undefined, TParams>;
  /** Maximum of a numeric field; `undefined` when no row matches. */
  max<TKey extends Extract<keyof TElement, string>>(
    key: TKey
  ): BinaryQueryBuilder<TElement, TOutput, number | undefined, TParams>;
}

export interface QueryParamRef<TValue = unknown> {
  readonly __jitQueryValue: "param";
  readonly name: string;
  readonly _type?: TValue;
}

export interface QueryConstRef<TValue = unknown> {
  readonly __jitQueryValue: "const";
  readonly value: TValue;
}

export function param<const TName extends string>(name: TName): QueryParamRef<never> & { readonly name: TName } {
  return { __jitQueryValue: "param", name, _type: null as never };
}

export function constant<const TValue extends string | number | bigint | boolean | null | undefined>(
  value: TValue
): QueryConstRef<TValue> {
  return { __jitQueryValue: "const", value };
}

/**
 * Creates a typed query builder for a collection schema.
 *
 * @template TSchema - The collection schema type.
 * @param schema - The schema or builder the query runs against.
 * @returns A fluent query builder that compiles to specialized JavaScript.
 */
export function query<TElement>(
  target: BinaryArray<TElement> | BinaryRowSet<TElement>
): BinaryQueryBuilder<TElement, TElement, TElement[]>;

export function query<TSchema extends ATS.AnyTypeSchema>(
  schema: SchemaInput<TSchema>
): QueryBuilder<
  TSchema,
  CollectionElementOf<ATS.TypeofSchema<TSchema>>,
  CollectionElementOf<ATS.TypeofSchema<TSchema>>[]
>;

export function query(schema: unknown): unknown {
  if (isBinaryArray(schema) || isBinaryRowSet(schema)) {
    return createBinaryQueryBuilder(schema, [], [], []);
  }

  const unwrapped = unwrapSchema(schema as SchemaInput<ATS.AnyTypeSchema>);

  // Querying something that is not a collection of objects is a declaration
  // mistake, not a runtime one: reject it before any operator is chained.
  expectCollectionObjectSchema(unwrapped, "query");
  return createQueryBuilder(unwrapped, [], [], []);
}

/** Internal bridge used by composable execution artifacts to retain query IR. */
export function getQueryProgram(builder: object): QueryProgram | undefined {
  return QUERY_PROGRAMS.get(builder);
}

function createBinaryQueryBuilder<
  TElement,
  TOutput,
  TResult,
  TParams extends Readonly<Record<string, unknown>> = Readonly<Record<never, never>>,
>(
  target: BinaryArray<TElement> | BinaryRowSet<TElement>,
  nodes: readonly QueryNode[],
  bindings: readonly unknown[],
  paramNames: readonly string[]
): BinaryQueryBuilder<TElement, TOutput, TResult, TParams> {
  let compiled: BinaryQueryCompiledFunction<TElement, TResult, TParams> | undefined;
  const callable = function binaryQuery(value: BinaryRowSet<TElement>, params?: TParams): TResult {
    compiled ??= compileBinaryQuery<TElement, TResult, TParams>(target, {
      nodes,
      bindings,
      params: paramNames,
    }) as BinaryQueryCompiledFunction<TElement, TResult, TParams>;
    return (compiled as (value: BinaryRowSet<TElement>, params?: TParams) => TResult)(value, params);
  } as BinaryQueryBuilder<TElement, TOutput, TResult, TParams>;

  const builder: BinaryQueryBuilder<TElement, TOutput, TResult, TParams> = Object.assign(callable, {
    params(shape) {
      return createBinaryQueryBuilder<TElement, TOutput, TResult, TParams & TypeofParamShape<typeof shape>>(
        target,
        nodes,
        bindings,
        mergeParamNames(paramNames, shape)
      );
    },

    filter(predicate) {
      const state = createConditionBuilder(bindings.length);
      const condition = predicate(state.builder as QueryConditionBuilder<TElement>, createParamRefs(paramNames));

      return createBinaryQueryBuilder(
        target,
        [...nodes, { kind: "filter", condition }],
        [...bindings, ...state.bindings],
        paramNames
      );
    },

    select(...fields) {
      return createBinaryQueryBuilder(target, [...nodes, { kind: "select:fields", fields }], bindings, paramNames);
    },

    sum(key) {
      return createBinaryQueryBuilder(target, [...nodes, { kind: "aggregate", op: "sum", key }], bindings, paramNames);
    },

    count() {
      return createBinaryQueryBuilder(target, [...nodes, { kind: "aggregate", op: "count" }], bindings, paramNames);
    },

    avg(key) {
      return createBinaryQueryBuilder(target, [...nodes, { kind: "aggregate", op: "avg", key }], bindings, paramNames);
    },

    min(key) {
      return createBinaryQueryBuilder(target, [...nodes, { kind: "aggregate", op: "min", key }], bindings, paramNames);
    },

    max(key) {
      return createBinaryQueryBuilder(target, [...nodes, { kind: "aggregate", op: "max", key }], bindings, paramNames);
    },
  } satisfies BinaryQueryBuilderOps<TElement, TOutput, TResult, TParams>);

  // Source is emitted only if AOT (or a golden test) asks for it; running the
  // query goes through the cached compile above instead.
  registerArtifact(builder, {
    kind: "query",
    get source(): string {
      return emitBinaryQuerySource(target.layout, {
        nodes,
        bindings,
        params: paramNames,
      });
    },
    get bindingNames(): readonly string[] {
      return bindings.map((_, index) => `__q${index}`);
    },
    bindingValues: bindings,
  });
  return builder;
}

function createQueryBuilder<
  TSchema extends ATS.AnyTypeSchema,
  TOutput,
  TResult,
  TParams extends Readonly<Record<string, unknown>> = Readonly<Record<never, never>>,
>(
  schema: TSchema,
  nodes: readonly QueryPipelineNode[],
  bindings: readonly unknown[],
  paramNames: readonly string[]
): QueryBuilder<TSchema, TOutput, TResult, TParams> {
  type QueryElement = CollectionElementOf<ATS.TypeofSchema<TSchema>>;
  let compiled: ((value: ATS.TypeofSchema<TSchema>, params?: TParams) => TResult) | undefined;
  // Incremental operators (take/chunk/scan/...) only have a streaming lowering,
  // so an eager call drains that generator once instead of compiling twice.
  const lowerEager = (): ((value: ATS.TypeofSchema<TSchema>, params?: TParams) => TResult) => {
    if (!hasIncrementalNodes(nodes)) {
      return compileQuery(schema, {
        nodes: nodes as readonly QueryNode[],
        bindings,
        params: paramNames,
      }) as (value: ATS.TypeofSchema<TSchema>, params?: TParams) => TResult;
    }

    return compileQueryArray<QueryElement, TOutput, TParams>(schema, {
      nodes,
      bindings,
      params: paramNames,
    }) as (value: ATS.TypeofSchema<TSchema>, params?: TParams) => TResult;
  };

  const callable = function query(value: ATS.TypeofSchema<TSchema>, params?: TParams): TResult {
    compiled ??= lowerEager();
    return compiled(value, params);
  } as QueryBuilder<TSchema, TOutput, TResult, TParams>;

  const builder: QueryBuilder<TSchema, TOutput, TResult, TParams> = Object.assign(callable, {
    params(shape) {
      return createQueryBuilder<TSchema, TOutput, TResult, TParams & TypeofParamShape<typeof shape>>(
        schema,
        nodes,
        bindings,
        mergeParamNames(paramNames, shape)
      );
    },

    filter(predicate) {
      const state = createConditionBuilder(bindings.length);
      const condition = predicate(
        state.builder as QueryConditionBuilder<CollectionElementOf<ATS.TypeofSchema<TSchema>>>,
        createParamRefs(paramNames)
      );

      return createQueryBuilder(
        schema,
        [...nodes, { kind: "filter", condition }],
        [...bindings, ...state.bindings],
        paramNames
      );
    },

    select(...fields) {
      return createQueryBuilder(schema, [...nodes, { kind: "select:fields", fields }], bindings, paramNames);
    },

    unique(key) {
      return createQueryBuilder(schema, [...nodes, { kind: "unique", key }], bindings, paramNames);
    },

    distinct(...fields) {
      return createQueryBuilder(schema, [...nodes, { kind: "distinct", fields }], bindings, paramNames);
    },

    keyed(key) {
      return createQueryBuilder(schema, [...nodes, { kind: "keyed", key }], bindings, paramNames);
    },

    groupBy(key) {
      return createQueryBuilder(schema, [...nodes, { kind: "groupBy", key }], bindings, paramNames);
    },

    orderBy(key, direction = "asc") {
      return createQueryBuilder(schema, [...nodes, { kind: "orderBy", key, direction }], bindings, paramNames);
    },

    flatMap(key) {
      return createQueryBuilder(schema, [...nodes, { kind: "flatMap", key }], bindings, paramNames);
    },

    take(count) {
      assertPositiveInteger(count, "query take");
      return createQueryBuilder(schema, [...nodes, { kind: "take", count }], bindings, paramNames);
    },

    drop(count) {
      assertNonNegativeInteger(count, "query drop");
      return createQueryBuilder(schema, [...nodes, { kind: "drop", count }], bindings, paramNames);
    },

    takeWhile(predicate) {
      const state = createConditionBuilder(bindings.length);
      const condition = predicate(
        state.builder as QueryConditionBuilder<CollectionElementOf<ATS.TypeofSchema<TSchema>>>,
        createParamRefs(paramNames)
      );
      return createQueryBuilder(
        schema,
        [...nodes, { kind: "takeWhile", condition }],
        [...bindings, ...state.bindings],
        paramNames
      );
    },

    dropWhile(predicate) {
      const state = createConditionBuilder(bindings.length);
      const condition = predicate(
        state.builder as QueryConditionBuilder<CollectionElementOf<ATS.TypeofSchema<TSchema>>>,
        createParamRefs(paramNames)
      );
      return createQueryBuilder(
        schema,
        [...nodes, { kind: "dropWhile", condition }],
        [...bindings, ...state.bindings],
        paramNames
      );
    },

    chunk(size) {
      assertPositiveInteger(size, "query chunk");
      return createQueryBuilder(schema, [...nodes, { kind: "chunk", size }], bindings, paramNames);
    },

    window(size) {
      assertPositiveInteger(size, "query window");
      return createQueryBuilder(schema, [...nodes, { kind: "window", size }], bindings, paramNames);
    },

    pairwise() {
      return createQueryBuilder(schema, [...nodes, { kind: "pairwise" }], bindings, paramNames);
    },

    scan(options) {
      const initialBinding = `__q${bindings.length}`;
      const updateBinding = `__q${bindings.length + 1}`;
      // The accumulator type is introduced by this method, so the builder it
      // produces cannot be related to the enclosing one structurally.
      return createQueryBuilder(
        schema,
        [...nodes, { kind: "scan", initialBinding, updateBinding }],
        [...bindings, options.initial, options.update],
        paramNames
      ) as never;
    },

    groupAdjacentBy(key) {
      return createQueryBuilder(schema, [...nodes, { kind: "groupAdjacentBy", key }], bindings, paramNames);
    },

    delete() {
      return createQueryBuilder(schema, [...nodes, { kind: "delete" }], bindings, paramNames);
    },

    update(patch) {
      const state = createPatchBindings(bindings.length, patch);

      return createQueryBuilder(
        schema,
        [...nodes, { kind: "update", patch: state.patch }],
        [...bindings, ...state.bindings],
        paramNames
      );
    },

    sum(key) {
      return createQueryBuilder(schema, [...nodes, { kind: "aggregate", op: "sum", key }], bindings, paramNames);
    },

    count() {
      return createQueryBuilder(schema, [...nodes, { kind: "aggregate", op: "count" }], bindings, paramNames);
    },

    avg(key) {
      return createQueryBuilder(schema, [...nodes, { kind: "aggregate", op: "avg", key }], bindings, paramNames);
    },

    min(key) {
      return createQueryBuilder(schema, [...nodes, { kind: "aggregate", op: "min", key }], bindings, paramNames);
    },

    max(key) {
      return createQueryBuilder(schema, [...nodes, { kind: "aggregate", op: "max", key }], bindings, paramNames);
    },

    aggregate(spec) {
      // Declaration order is the emission order and the result key order, so
      // the same declaration always produces the same source.
      const fields = Object.entries(spec).map(([name, field]) => ({
        name,
        op: field.op,
        ...(field.key === undefined ? {} : { key: field.key }),
      }));

      return createQueryBuilder(
        schema,
        [...nodes, { kind: "aggregate:composite", fields }],
        bindings,
        paramNames
      ) as never;
    },

    first() {
      return createQueryBuilder(schema, [...nodes, { kind: "terminal", op: "first" }], bindings, paramNames);
    },

    findIndex() {
      return createQueryBuilder(schema, [...nodes, { kind: "terminal", op: "findIndex" }], bindings, paramNames);
    },

    some() {
      return createQueryBuilder(schema, [...nodes, { kind: "terminal", op: "some" }], bindings, paramNames);
    },

    every() {
      return createQueryBuilder(schema, [...nodes, { kind: "terminal", op: "every" }], bindings, paramNames);
    },

    to: Object.freeze({
      iterator: () =>
        compileQueryIterator<QueryElement, TOutput, TParams>(schema, {
          nodes,
          bindings,
          params: paramNames,
        }),
      asyncIterator: () =>
        compileQueryAsyncIterator<QueryElement, TOutput, TParams>(schema, {
          nodes,
          bindings,
          params: paramNames,
        }),
      visitor: () =>
        compileQueryVisitor<QueryElement, TOutput, TParams>(schema, {
          nodes,
          bindings,
          params: paramNames,
        }),
    }),

    lazy() {
      return createLazyQueryBuilder(schema, nodes, bindings, paramNames);
    },

    explain(outputMode = "eager-array") {
      const plan = explainQueryExecution({ nodes, bindings, params: paramNames }, outputMode);

      // The access path is only meaningful for the eager backend; the
      // incremental ones stream and never reach a row by key.
      if (outputMode !== "eager-array") return plan;
      return Object.freeze({
        ...plan,
        physical: explainPhysicalQuery(schema, {
          nodes: nodes as readonly QueryNode[],
          bindings,
          params: paramNames,
        }),
      });
    },
  } satisfies QueryBuilderOps<TSchema, TOutput, TResult, TParams>);

  const program = {
    nodes: nodes as readonly QueryNode[],
    bindings,
    params: paramNames,
  };

  QUERY_PROGRAMS.set(builder, program);
  // The builder is what a declaration file exports, so it carries the plan
  // AOT needs; nothing is compiled unless the query is actually called.
  registerArtifact(builder, {
    kind: "query-plan",
    schema,
    program,
    mode: "array",
  });
  return builder;
}

function createLazyQueryBuilder<
  TSchema extends ATS.AnyTypeSchema,
  TOutput,
  TParams extends Readonly<Record<string, unknown>>,
>(
  schema: TSchema,
  nodes: readonly QueryPipelineNode[],
  bindings: readonly unknown[],
  paramNames: readonly string[]
): LazyQueryBuilder<TSchema, TOutput, TParams> {
  type QueryElement = CollectionElementOf<ATS.TypeofSchema<TSchema>>;
  const program = { nodes, bindings, params: paramNames };
  let compiled: QueryIteratorCompiled<QueryElement, TOutput, TParams> | undefined;
  const callable = function lazyQuery(input: never, params?: never) {
    compiled ??= compileQueryIterator<QueryElement, TOutput, TParams>(schema, program);
    return (compiled as (input: never, params?: never) => unknown)(input, params);
  } as LazyQueryBuilder<TSchema, TOutput, TParams>;

  const builder = Object.assign(callable, {
    to: Object.freeze({
      asyncIterator: () => compileQueryAsyncIterator<QueryElement, TOutput, TParams>(schema, program),
      visitor: () => compileQueryVisitor<QueryElement, TOutput, TParams>(schema, program),
    }),
    explain: (outputMode: "generator" | "async-generator" | "visitor" = "generator") =>
      explainQueryExecution(program, outputMode),
  });

  registerArtifact(builder, {
    kind: "query-plan",
    schema,
    program,
    mode: "iterator",
  });
  return builder;
}

function hasIncrementalNodes(nodes: readonly QueryPipelineNode[]): boolean {
  return nodes.some((node) =>
    [
      "flatMap",
      "take",
      "drop",
      "takeWhile",
      "dropWhile",
      "chunk",
      "window",
      "pairwise",
      "scan",
      "groupAdjacentBy",
    ].includes(node.kind)
  );
}

function assertPositiveInteger(value: number, label: string): void {
  if (!Number.isInteger(value) || value <= 0)
    throw new JITError("INVALID_QUERY", `${label} expects a positive integer`);
}

function assertNonNegativeInteger(value: number, label: string): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new JITError("INVALID_QUERY", `${label} expects a non-negative integer`);
  }
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
  const toValueNode = (value: unknown): QueryValueNode => {
    if (isQueryParamRef(value)) return { kind: "param", name: value.name };
    if (isQueryConstRef(value)) return { kind: "literal", value: value.value };

    const index = startIndex + bindings.length;
    bindings[bindings.length] = value;
    return { kind: "binding", name: `__q${index}` };
  };
  const compare = (op: QueryCompareOperator, key: string, value: unknown): QueryCompareNode => ({
    kind: "compare",
    op,
    left: { kind: "field", key },
    right: toValueNode(value),
  });

  return {
    bindings,
    builder: {
      constant,
      eq: (key, value) => compare("eq", key, value),
      neq: (key, value) => compare("neq", key, value),
      gt: (key, value) => compare("gt", key, value),
      gte: (key, value) => compare("gte", key, value),
      lt: (key, value) => compare("lt", key, value),
      lte: (key, value) => compare("lte", key, value),
      and: (left, right, ...rest) => fold("and", left, right, rest),
      or: (left, right, ...rest) => fold("or", left, right, rest),
      not: (inner) => ({ kind: "not", inner }),
    },
  };
}

/**
 * Right-associative fold so `q.and(a, b, c)` is exactly `q.and(a, q.and(b, c))`.
 * The IR stays binary, which keeps the optimizer's cost model and the
 * byte-exact goldens unchanged for the two-argument case.
 */
function fold(
  op: "and" | "or",
  left: QueryConditionNode,
  right: QueryConditionNode,
  rest: readonly QueryConditionNode[]
): QueryConditionNode {
  const tail = rest.length === 0 ? right : fold(op, right, rest[0], rest.slice(1));

  return { kind: "logical", op, left, right: tail };
}

function mergeParamNames(current: readonly string[], shape: ParamSchemaShape): readonly string[] {
  const next = [...current];
  const seen = new Set(current);

  for (const name of Object.keys(shape)) {
    if (seen.has(name)) throw new JITError("INVALID_QUERY", `query parameter ${JSON.stringify(name)} is duplicated`);
    seen.add(name);
    next.push(name);
  }
  return next;
}

function createParamRefs<TParams extends Readonly<Record<string, unknown>>>(
  names: readonly string[]
): QueryRuntimeParams<TParams> {
  const refs: Record<string, QueryParamRef> = {};

  for (const name of names) refs[name] = param(name);
  return refs as QueryRuntimeParams<TParams>;
}

function isQueryParamRef(value: unknown): value is QueryParamRef {
  return (
    value !== null &&
    typeof value === "object" &&
    (value as { readonly __jitQueryValue?: unknown }).__jitQueryValue === "param"
  );
}

function isQueryConstRef(value: unknown): value is QueryConstRef {
  return (
    value !== null &&
    typeof value === "object" &&
    (value as { readonly __jitQueryValue?: unknown }).__jitQueryValue === "const"
  );
}
