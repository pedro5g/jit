import {
  type BinaryArray,
  type BinaryRowSet,
  compileBinaryQuery,
  isBinaryArray,
  isBinaryRowSet,
} from "../compiler/binary-rowset.js";
import {
  compileQueryAsyncIterator,
  compileQueryIterator,
  compileQueryVisitor,
  explainQueryExecution,
  type QueryAsyncIteratorCompiled,
  type QueryExecutionPlan,
  type QueryIteratorCompiled,
  type QueryVisitorCompiled,
} from "../compiler/lazy-query.js";
import { compileQuery } from "../compiler/query.js";
import type {
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
type QueryCompiledFunction<
  TSchema extends ATS.AnyTypeSchema,
  TResult,
  TParams extends Readonly<Record<string, unknown>>,
> = keyof TParams extends never
  ? (value: ATS.TypeofSchema<TSchema>) => TResult
  : (value: ATS.TypeofSchema<TSchema>, params: TParams) => TResult;
type BinaryQueryCompiledFunction<
  TElement,
  TResult,
  TParams extends Readonly<Record<string, unknown>>,
> = keyof TParams extends never
  ? (value: BinaryRowSet<TElement>) => TResult
  : (value: BinaryRowSet<TElement>, params: TParams) => TResult;
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
export interface QueryBuilder<
  TSchema extends ATS.AnyTypeSchema,
  TOutput,
  TResult = TOutput[],
  TParams extends Readonly<Record<string, unknown>> = Readonly<Record<never, never>>,
> {
  params<const TShape extends ParamSchemaShape>(
    shape: TShape
  ): QueryBuilder<TSchema, TOutput, TResult, TypeofParamShape<TShape>>;
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
  compile(): QueryCompiledFunction<TSchema, TResult, TParams>;
  compileIterator(): QueryIteratorCompiled<CollectionElementOf<ATS.TypeofSchema<TSchema>>, TOutput, TParams>;
  compileAsyncIterator(): QueryAsyncIteratorCompiled<CollectionElementOf<ATS.TypeofSchema<TSchema>>, TOutput, TParams>;
  compileVisitor(): QueryVisitorCompiled<CollectionElementOf<ATS.TypeofSchema<TSchema>>, TOutput, TParams>;
  lazy(): LazyQueryBuilder<TSchema, TOutput, TParams>;
  explain(outputMode?: "eager-array" | "generator" | "async-generator" | "visitor"): QueryExecutionPlan;
}

export interface LazyQueryBuilder<
  TSchema extends ATS.AnyTypeSchema,
  TOutput,
  TParams extends Readonly<Record<string, unknown>> = Readonly<Record<never, never>>,
> {
  compile(): QueryIteratorCompiled<CollectionElementOf<ATS.TypeofSchema<TSchema>>, TOutput, TParams>;
  compileIterator(): QueryIteratorCompiled<CollectionElementOf<ATS.TypeofSchema<TSchema>>, TOutput, TParams>;
  compileAsyncIterator(): QueryAsyncIteratorCompiled<CollectionElementOf<ATS.TypeofSchema<TSchema>>, TOutput, TParams>;
  compileVisitor(): QueryVisitorCompiled<CollectionElementOf<ATS.TypeofSchema<TSchema>>, TOutput, TParams>;
  explain(outputMode?: "generator" | "async-generator" | "visitor"): QueryExecutionPlan;
}

/**
 * Query builder backed by a binary rowset layout. It accepts the same filter
 * AST as regular `JIT.query`, but compiles supported filters/projections into
 * byte-offset scans over `ArrayBuffer` rows.
 */
export interface BinaryQueryBuilder<
  TElement,
  TOutput,
  TResult = TOutput[],
  TParams extends Readonly<Record<string, unknown>> = Readonly<Record<never, never>>,
> {
  params<const TShape extends ParamSchemaShape>(
    shape: TShape
  ): BinaryQueryBuilder<TElement, TOutput, TResult, TypeofParamShape<TShape>>;
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
  compile(): BinaryQueryCompiledFunction<TElement, TResult, TParams>;
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

  return createQueryBuilder(unwrapSchema(schema as SchemaInput<ATS.AnyTypeSchema>), [], [], []);
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
  return {
    params(shape) {
      return createBinaryQueryBuilder<TElement, TOutput, TResult, TypeofParamShape<typeof shape>>(
        target,
        nodes,
        bindings,
        Object.keys(shape)
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

    compile() {
      return compileBinaryQuery<TElement, TResult, TParams>(target, {
        nodes,
        bindings,
        params: paramNames,
      });
    },
  };
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
  return {
    params(shape) {
      return createQueryBuilder<TSchema, TOutput, TResult, TypeofParamShape<typeof shape>>(
        schema,
        nodes,
        bindings,
        Object.keys(shape)
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
      return createQueryBuilder(
        schema,
        [...nodes, { kind: "scan", initialBinding, updateBinding }],
        [...bindings, options.initial, options.update],
        paramNames
      );
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

    compile() {
      if (!hasIncrementalNodes(nodes)) {
        return compileQuery(schema, {
          nodes: nodes as readonly QueryNode[],
          bindings,
          params: paramNames,
        }) as QueryCompiledFunction<TSchema, TResult, TParams>;
      }
      const iterator = compileQueryIterator(schema, {
        nodes,
        bindings,
        params: paramNames,
      });
      return ((value: ATS.TypeofSchema<TSchema>, params?: TParams) =>
        Array.from(
          paramNames.length > 0
            ? (iterator as (input: Iterable<unknown>, params: TParams) => Iterable<unknown>)(
                value as Iterable<unknown>,
                params as TParams
              )
            : (iterator as (input: Iterable<unknown>) => Iterable<unknown>)(value as Iterable<unknown>)
        )) as QueryCompiledFunction<TSchema, TResult, TParams>;
    },

    compileIterator() {
      return compileQueryIterator(schema, {
        nodes,
        bindings,
        params: paramNames,
      });
    },

    compileAsyncIterator() {
      return compileQueryAsyncIterator(schema, {
        nodes,
        bindings,
        params: paramNames,
      });
    },

    compileVisitor() {
      return compileQueryVisitor(schema, {
        nodes,
        bindings,
        params: paramNames,
      });
    },

    lazy() {
      return createLazyQueryBuilder(schema, nodes, bindings, paramNames);
    },

    explain(outputMode = "eager-array") {
      return explainQueryExecution({ nodes, bindings, params: paramNames }, outputMode);
    },
  };
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
  const program = { nodes, bindings, params: paramNames };
  return {
    compile: () => compileQueryIterator(schema, program),
    compileIterator: () => compileQueryIterator(schema, program),
    compileAsyncIterator: () => compileQueryAsyncIterator(schema, program),
    compileVisitor: () => compileQueryVisitor(schema, program),
    explain: (outputMode = "generator") => explainQueryExecution(program, outputMode),
  };
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
      and: (left, right) => ({ kind: "logical", op: "and", left, right }),
      or: (left, right) => ({ kind: "logical", op: "or", left, right }),
      not: (inner) => ({ kind: "not", inner }),
    },
  };
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
