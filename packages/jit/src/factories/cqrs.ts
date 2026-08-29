import { type BinaryArray, type BinaryRowSet, isBinaryArray, isBinaryRowSet } from "../compiler/binary-rowset.js";
import { compileJoin, createJoinPlan, explainJoinPlan, type JoinPair, type LeftJoinPair } from "../compiler/join.js";
import type {
  QueryAggregateOperator,
  QueryConditionNode,
  QueryJoinKind,
  QueryPipelineNode,
  QueryValueNode,
} from "../core/ast/index.js";
import type * as ATS from "../core/ats/index.js";
import type { SchemaInput } from "../core/builder/index.js";
import { unwrapSchema } from "../core/builder/index.js";
import { JITError } from "../errors/index.js";
import { getArtifact, registerArtifact } from "../runtime/artifact-registry.js";
import { array } from "./collection/collection.js";
import {
  type BinaryQueryBuilder,
  constant,
  query as createQuery,
  getQueryProgram,
  type LazyQueryBuilder,
  param,
  type QueryBuilder,
  type QueryConditionBuilder,
  type QueryRuntimeParams,
  type QuerySinks,
} from "./query.js";
import type { RulePredicate } from "./rules.js";

export interface StandardQuery {
  readonly version: 1;
  readonly definition: StandardQueryDefinition;
}

/** Portable V1 description; deliberately independent from JIT's execution IR. */
export interface StandardQueryDefinition {
  readonly source: {
    readonly kind: "object";
    readonly fields: readonly string[];
  };
  /** Ordered portable semantics. Private query and physical-plan nodes never cross this boundary. */
  readonly pipeline: readonly StandardQueryStep[];
  readonly filter?: StandardQueryCondition;
  readonly projection?: readonly string[];
  readonly order?: readonly {
    readonly path: readonly string[];
    readonly direction: "asc" | "desc";
  }[];
  readonly limit?: number;
  readonly params: readonly string[];
}

export type StandardQueryStep =
  | { readonly kind: "where"; readonly condition: StandardQueryCondition }
  | { readonly kind: "select"; readonly fields: readonly string[] }
  | { readonly kind: "distinct"; readonly fields: readonly string[] }
  | {
      readonly kind: "unique" | "keyed" | "groupBy" | "orderBy" | "flatMap" | "groupAdjacentBy";
      readonly key: string;
      readonly direction?: "asc" | "desc";
    }
  | { readonly kind: "take" | "drop"; readonly count: number }
  | {
      readonly kind: "takeWhile" | "dropWhile";
      readonly condition: StandardQueryCondition;
    }
  | { readonly kind: "chunk" | "window"; readonly size: number }
  | { readonly kind: "pairwise" | "delete" }
  | {
      readonly kind: "scan";
      readonly initial: StandardQueryValue;
      readonly update: { readonly kind: "binding"; readonly name: string };
    }
  | {
      readonly kind: "update";
      readonly patch: Readonly<Record<string, StandardQueryValue>>;
    }
  | {
      readonly kind: "aggregate";
      readonly operation: "sum" | "count" | "avg" | "min" | "max";
      readonly key?: string;
    }
  | {
      readonly kind: "terminal";
      readonly operation: "first" | "findIndex" | "some" | "every";
    }
  | {
      readonly kind: "aggregate:composite";
      readonly fields: readonly {
        readonly name: string;
        readonly operation: "sum" | "count" | "avg" | "min" | "max";
        readonly key?: string;
      }[];
    }
  | {
      readonly kind: "join";
      readonly join: QueryJoinKind;
      readonly source: {
        readonly kind: "object";
        readonly fields: readonly string[];
      };
      readonly leftKey: string;
      readonly rightKey: string;
    };

export type StandardQueryValue =
  | { readonly kind: "field"; readonly path: readonly string[] }
  | { readonly kind: "literal"; readonly value: unknown }
  | { readonly kind: "binding"; readonly name: string }
  | { readonly kind: "param"; readonly name: string };

export type StandardQueryCondition =
  | {
      readonly kind: "compare";
      readonly operator: "eq" | "neq" | "gt" | "gte" | "lt" | "lte";
      readonly left: StandardQueryValue;
      readonly right: StandardQueryValue;
    }
  | {
      readonly kind: "logical";
      readonly operator: "and" | "or";
      readonly left: StandardQueryCondition;
      readonly right: StandardQueryCondition;
    }
  | { readonly kind: "not"; readonly inner: StandardQueryCondition };

export interface CqrsInputOptions<TSchema extends ATS.AnyTypeSchema> {
  readonly filter?: Partial<
    Record<
      | Extract<keyof ATS.TypeofSchema<TSchema>, string>
      | `${Extract<keyof ATS.TypeofSchema<TSchema>, string>}.${string}`,
      true | readonly string[]
    >
  >;
  readonly select?: boolean;
  readonly sort?: readonly Extract<keyof ATS.TypeofSchema<TSchema>, string>[];
  readonly pagination?:
    | {
        readonly type: "offset";
        readonly defaultLimit: number;
        readonly maxLimit: number;
      }
    | {
        readonly type: "cursor";
        readonly by: readonly Extract<keyof ATS.TypeofSchema<TSchema>, string>[];
        readonly defaultLimit: number;
        readonly maxLimit: number;
      };
  readonly maxFilters?: number;
  /** Structural budgets for untrusted request syntax; omitted limits retain the compact defaults. */
  readonly limits?: {
    readonly maxConditions?: number;
    readonly maxSortFields?: number;
    readonly maxSelectFields?: number;
  };
}

type CqrsPagination =
  | {
      readonly type: "offset";
      readonly defaultLimit: number;
      readonly maxLimit: number;
    }
  | {
      readonly type: "cursor";
      readonly by: readonly string[];
      readonly defaultLimit: number;
      readonly maxLimit: number;
    };

export interface CqrsInput<TSchema extends ATS.AnyTypeSchema> {
  readonly schema: TSchema;
  readonly options: CqrsInputOptions<TSchema>;
  readonly "~query": StandardQueryInput;
}

/** Structural dynamic-query definition that adapters may inspect without importing JIT. */
export interface StandardQueryInput {
  readonly version: 1;
  readonly definition: {
    readonly source: {
      readonly kind: "object";
      readonly fields: readonly string[];
    };
    readonly filters: Readonly<Record<string, true | readonly string[]>>;
    readonly projection: boolean;
    readonly sorting: readonly string[];
    readonly pagination?:
      | {
          readonly type: "offset";
          readonly defaultLimit: number;
          readonly maxLimit: number;
        }
      | {
          readonly type: "cursor";
          readonly by: readonly string[];
          readonly defaultLimit: number;
          readonly maxLimit: number;
        };
    readonly limits: {
      readonly maxConditions: number;
      readonly maxSortFields: number;
      readonly maxSelectFields: number;
    };
  };
}
export interface CqrsInputCondition {
  readonly kind: string;
  readonly path: readonly string[];
  readonly value: unknown;
}
export interface ParsedCqrsInput {
  readonly filter: readonly CqrsInputCondition[];
  readonly select?: readonly string[];
  readonly sort: readonly {
    readonly path: readonly string[];
    readonly direction: "asc" | "desc";
  }[];
  readonly pagination?:
    | {
        readonly kind: "offset";
        readonly offset: number;
        readonly limit: number;
      }
    | {
        readonly kind: "cursor";
        readonly limit: number;
        readonly after?: readonly unknown[];
        readonly before?: readonly unknown[];
      };
}

type Row<TSchema extends ATS.AnyTypeSchema> = ATS.TypeofSchema<TSchema>;
type JoinRowSchema<TSchema extends ATS.AnyTypeSchema> = TSchema extends ATS.ArraySchema<infer TRow> ? TRow : TSchema;
type CqrsAggregateResult<TSpec> = {
  readonly [TKey in keyof TSpec]: TSpec[TKey] extends CqrsAggregateSpec<infer TResult> ? TResult : never;
};
/** A grouped query keeps its record shape and replaces the rows per key. */
type CqrsAggregateOutput<TResult, TAggregates> =
  TResult extends Record<infer TKey extends PropertyKey, unknown[]> ? Record<TKey, TAggregates> : TAggregates;
type CqrsKey<TSchema extends ATS.AnyTypeSchema> = Extract<keyof Row<TSchema>, string>;
type CqrsNumericKey<TSchema extends ATS.AnyTypeSchema> = {
  [TKey in CqrsKey<TSchema>]: Row<TSchema>[TKey] extends number ? TKey : never;
}[CqrsKey<TSchema>];
type CqrsSelectResult<TResult, TSelected> =
  TResult extends Map<infer TKey, unknown>
    ? Map<TKey, TSelected>
    : TResult extends Record<infer TKey extends PropertyKey, unknown[]>
      ? Record<TKey, TSelected[]>
      : TSelected[];
type CqrsProjection<TValue, TKey extends keyof TValue, TReadonly extends boolean> = TReadonly extends true
  ? { readonly [TField in TKey]: TValue[TField] }
  : Pick<TValue, TKey>;
type IterableElement<TValue> = TValue extends Iterable<infer TElement> ? TElement : never;
type ParamShape = Readonly<Record<string, SchemaInput>>;
type Params<TShape extends ParamShape> = {
  readonly [TKey in keyof TShape]: TShape[TKey] extends SchemaInput<infer TSchema> ? ATS.TypeofSchema<TSchema> : never;
};
type CompatibleJoinKey<TSchema extends ATS.AnyTypeSchema, TValue> = {
  [TKey in CqrsKey<TSchema>]: Row<TSchema>[TKey] extends TValue
    ? TValue extends Row<TSchema>[TKey]
      ? TKey
      : never
    : never;
}[CqrsKey<TSchema>];
type JoinResult<TLeft, TRight, TKind extends QueryJoinKind> = TKind extends "semi" | "anti"
  ? TLeft[]
  : TKind extends "left"
    ? LeftJoinPair<TLeft, TRight>[]
    : JoinPair<TLeft, TRight>[];

export interface CqrsJoinOnBuilder<
  TLeftSchema extends ATS.AnyTypeSchema,
  TRightSchema extends ATS.AnyTypeSchema,
  TKind extends QueryJoinKind,
  TParams extends Readonly<Record<string, unknown>>,
> {
  on<
    TLeftKey extends CqrsKey<TLeftSchema>,
    TRightKey extends CompatibleJoinKey<TRightSchema, Row<TLeftSchema>[TLeftKey]>,
  >(leftKey: TLeftKey, rightKey: TRightKey): CqrsJoinedQuery<TLeftSchema, TRightSchema, TKind, TParams>;
}

export type CqrsJoinedQuery<
  TLeftSchema extends ATS.AnyTypeSchema,
  TRightSchema extends ATS.AnyTypeSchema,
  TKind extends QueryJoinKind,
  TParams extends Readonly<Record<string, unknown>>,
> = ((
  left: readonly Row<TLeftSchema>[],
  right: readonly Row<TRightSchema>[],
  params?: TParams
) => JoinResult<Row<TLeftSchema>, Row<TRightSchema>, TKind>) & {
  explain(): ReturnType<typeof explainJoinPlan>;
  readonly "~query": StandardQuery;
};
interface CqrsQueryOps<
  TSchema extends ATS.AnyTypeSchema,
  TOutput,
  TResult,
  TParams extends Readonly<Record<string, unknown>>,
  TReadonlyProjection extends boolean,
> {
  authorize<TAction extends string, TActor>(
    ability:
      | import("./access.js").Ability<Row<TSchema>, TAction>
      | import("./access.js").AccessPlan<Row<TSchema>, TActor, TAction>,
    action: TAction,
    actor?: TActor
  ): CqrsQuery<TSchema, TOutput, TResult, TParams, TReadonlyProjection>;
  params<const TShape extends ParamShape>(
    shape: TShape
  ): CqrsQuery<TSchema, TOutput, TResult, TParams & Params<TShape>, TReadonlyProjection>;
  filter(
    predicate: (query: QueryConditionBuilder<Row<TSchema>>, params: QueryRuntimeParams<TParams>) => QueryConditionNode
  ): CqrsQuery<TSchema, TOutput, TResult, TParams, TReadonlyProjection>;
  select<const TKeys extends readonly Extract<keyof TOutput, string>[]>(
    ...fields: TKeys
  ): CqrsQuery<
    TSchema,
    CqrsProjection<TOutput, TKeys[number], TReadonlyProjection>,
    CqrsSelectResult<TResult, CqrsProjection<TOutput, TKeys[number], TReadonlyProjection>>,
    TParams,
    TReadonlyProjection
  >;
  unique<TKey extends CqrsKey<TSchema>>(key: TKey): CqrsQuery<TSchema, TOutput, TResult, TParams, TReadonlyProjection>;
  distinct<const TKeys extends readonly CqrsKey<TSchema>[]>(
    ...fields: TKeys
  ): CqrsQuery<TSchema, TOutput, TResult, TParams, TReadonlyProjection>;
  keyed<TKey extends CqrsKey<TSchema>>(
    key: TKey
  ): CqrsQuery<TSchema, TOutput, Map<Row<TSchema>[TKey], TOutput>, TParams, TReadonlyProjection>;
  groupBy<TKey extends CqrsKey<TSchema>>(
    key: TKey
  ): CqrsQuery<
    TSchema,
    TOutput,
    Record<Extract<Row<TSchema>[TKey], PropertyKey>, TOutput[]>,
    TParams,
    TReadonlyProjection
  >;
  orderBy<TKey extends CqrsKey<TSchema>>(
    key: TKey,
    direction?: "asc" | "desc"
  ): CqrsQuery<TSchema, TOutput, TResult, TParams, TReadonlyProjection>;
  flatMap<TKey extends Extract<keyof TOutput, string>>(
    key: TKey
  ): CqrsQuery<TSchema, IterableElement<TOutput[TKey]>, IterableElement<TOutput[TKey]>[], TParams, TReadonlyProjection>;
  take(count: number): CqrsQuery<TSchema, TOutput, TResult, TParams, TReadonlyProjection>;
  drop(count: number): CqrsQuery<TSchema, TOutput, TResult, TParams, TReadonlyProjection>;
  takeWhile(
    predicate: (query: QueryConditionBuilder<Row<TSchema>>, params: QueryRuntimeParams<TParams>) => QueryConditionNode
  ): CqrsQuery<TSchema, TOutput, TResult, TParams, TReadonlyProjection>;
  dropWhile(
    predicate: (query: QueryConditionBuilder<Row<TSchema>>, params: QueryRuntimeParams<TParams>) => QueryConditionNode
  ): CqrsQuery<TSchema, TOutput, TResult, TParams, TReadonlyProjection>;
  chunk(size: number): CqrsQuery<TSchema, TOutput[], TOutput[][], TParams, TReadonlyProjection>;
  window(size: number): CqrsQuery<TSchema, TOutput[], TOutput[][], TParams, TReadonlyProjection>;
  pairwise(): CqrsQuery<
    TSchema,
    readonly [TOutput, TOutput],
    (readonly [TOutput, TOutput])[],
    TParams,
    TReadonlyProjection
  >;
  scan<TAccumulator>(options: {
    readonly initial: TAccumulator;
    readonly update: (accumulator: TAccumulator, value: TOutput) => TAccumulator | Promise<TAccumulator>;
  }): CqrsQuery<TSchema, TAccumulator, TAccumulator[], TParams, TReadonlyProjection>;
  groupAdjacentBy<TKey extends Extract<keyof TOutput, string>>(
    key: TKey
  ): CqrsQuery<TSchema, TOutput[], TOutput[][], TParams, TReadonlyProjection>;
  delete(): CqrsQuery<TSchema, TOutput, Row<TSchema>[], TParams, TReadonlyProjection>;
  update(
    patch: {
      readonly [TKey in CqrsKey<TSchema>]?: Row<TSchema>[TKey];
    }
  ): CqrsQuery<TSchema, TOutput, Row<TSchema>[], TParams, TReadonlyProjection>;
  sum<TKey extends CqrsNumericKey<TSchema>>(
    key: TKey
  ): CqrsQuery<TSchema, TOutput, number, TParams, TReadonlyProjection>;
  count(): CqrsQuery<TSchema, TOutput, number, TParams, TReadonlyProjection>;
  avg<TKey extends CqrsNumericKey<TSchema>>(
    key: TKey
  ): CqrsQuery<TSchema, TOutput, number | undefined, TParams, TReadonlyProjection>;
  min<TKey extends CqrsNumericKey<TSchema>>(
    key: TKey
  ): CqrsQuery<TSchema, TOutput, number | undefined, TParams, TReadonlyProjection>;
  max<TKey extends CqrsNumericKey<TSchema>>(
    key: TKey
  ): CqrsQuery<TSchema, TOutput, number | undefined, TParams, TReadonlyProjection>;
  /**
   * Several reductions over one pass. Each field keeps its own accumulator, so
   * asking for four answers still reads the collection once.
   */
  aggregate<const TSpec extends Readonly<Record<string, CqrsAggregateSpec<unknown>>>>(
    spec: TSpec
  ): CqrsQuery<
    TSchema,
    TOutput,
    CqrsAggregateOutput<TResult, CqrsAggregateResult<TSpec>>,
    TParams,
    TReadonlyProjection
  >;
  /**
   * Returns the first matching row, or `undefined`. The answer comes from
   * inside the loop, so nothing is collected and the scan stops there.
   */
  first(): CqrsQuery<TSchema, TOutput, TOutput | undefined, TParams, TReadonlyProjection>;
  /** Index of the first matching row in the input, or `-1`. */
  findIndex(): CqrsQuery<TSchema, TOutput, number, TParams, TReadonlyProjection>;
  /** True as soon as one row matches; stops there. */
  some(): CqrsQuery<TSchema, TOutput, boolean, TParams, TReadonlyProjection>;
  /** True when every row matches; stops at the first that does not. */
  every(): CqrsQuery<TSchema, TOutput, boolean, TParams, TReadonlyProjection>;
  join<TRightTarget extends ATS.AnyTypeSchema, TKind extends QueryJoinKind = "inner">(
    schema: SchemaInput<TRightTarget>,
    kind?: TKind
  ): CqrsJoinOnBuilder<TSchema, JoinRowSchema<TRightTarget>, TKind, TParams>;
  readonly to: QuerySinks<ATS.ArraySchema<TSchema>, TOutput, TParams>;
  lazy(): LazyQueryBuilder<ATS.ArraySchema<TSchema>, TOutput, TParams>;
  explain(
    outputMode?: "eager-array" | "generator" | "async-generator" | "visitor"
  ): ReturnType<QueryBuilder<ATS.ArraySchema<TSchema>, TOutput, TResult, TParams>["explain"]>;
}
export type CqrsQuery<
  TSchema extends ATS.AnyTypeSchema,
  TOutput = Row<TSchema>,
  TResult = TOutput[],
  TParams extends Readonly<Record<string, unknown>> = Readonly<Record<never, never>>,
  TReadonlyProjection extends boolean = false,
> = ((value: Row<TSchema>[], params?: TParams) => TResult) &
  CqrsQueryOps<TSchema, TOutput, TResult, TParams, TReadonlyProjection> & {
    where(
      predicate: (query: QueryConditionBuilder<Row<TSchema>>, params: QueryRuntimeParams<TParams>) => QueryConditionNode
    ): CqrsQuery<TSchema, TOutput, TResult, TParams, false>;
    /**
     * Filters by a compiled rule predicate. The rule lowers into this query's
     * condition AST, so the decision is fused into the same scan and the
     * query protocol still sees an ordinary predicate.
     */
    where<TInputs extends Readonly<Record<string, unknown>>>(
      predicate: RulePredicate<Row<TSchema>, TInputs>,
      ...inputs: keyof TInputs extends never ? readonly [] : readonly [inputs: TInputs]
    ): CqrsQuery<TSchema, TOutput, TResult, TParams, false>;
    limit(count: number): CqrsQuery<TSchema, TOutput, TResult, TParams, TReadonlyProjection>;
    readonly "~query": StandardQuery;
  };

export function cqrsQuery<TElement>(
  target: BinaryArray<TElement> | BinaryRowSet<TElement>
): BinaryQueryBuilder<TElement, TElement, TElement[]>;
export function cqrsQuery<TSchema extends ATS.AnyTypeSchema>(schema: SchemaInput<TSchema>): CqrsQueryFor<TSchema>;
export function cqrsQuery(
  schema: SchemaInput | BinaryArray<unknown> | BinaryRowSet<unknown>
):
  | CqrsQuery<ATS.AnyTypeSchema>
  | QueryBuilder<ATS.AnyTypeSchema, unknown, unknown[]>
  | BinaryQueryBuilder<unknown, unknown, unknown[]> {
  if (isBinaryArray(schema) || isBinaryRowSet(schema)) return createQuery(schema);

  const target = unwrapSchema(schema);
  if (target.type === "set" || target.type === "map") {
    return createQuery(target) as QueryBuilder<ATS.AnyTypeSchema, unknown, unknown[]>;
  }
  if (target.type !== "array" && target.type !== "object" && target.type !== "runtimeType") {
    throw new JITError(
      "INVALID_QUERY",
      "JIT.cqrs.query() requires an object or Runtime Type, or a collection of either"
    );
  }
  const row = target.type === "array" ? (target as ATS.ArraySchema<ATS.AnyTypeSchema>).def.element : target;
  if (row.type !== "object" && row.type !== "runtimeType") return createQuery(target) as never;
  const collection = target.type === "array" ? (target as ATS.ArraySchema<ATS.AnyTypeSchema>) : array(row).schema;
  return wrap(
    row,
    collection,
    createQuery(collection) as QueryBuilder<ATS.ArraySchema<ATS.AnyTypeSchema>, unknown, unknown[]>
  );
}

type QueryElement<TSchema extends ATS.AnyTypeSchema> =
  ATS.TypeofSchema<TSchema> extends readonly (infer TElement)[]
    ? TElement
    : ATS.TypeofSchema<TSchema> extends Set<infer TElement>
      ? TElement
      : ATS.TypeofSchema<TSchema> extends Map<unknown, infer TElement>
        ? TElement
        : never;

export type CqrsQueryFor<TSchema extends ATS.AnyTypeSchema> = TSchema extends {
  readonly type: "array";
  readonly def: Readonly<{ readonly element: infer TElement extends ATS.AnyTypeSchema }>;
}
  ? CqrsQuery<TElement, Row<TElement>, Row<TElement>[], Readonly<Record<never, never>>, true>
  : TSchema extends { readonly type: "object" | "runtimeType" }
    ? CqrsQuery<TSchema>
    : QueryBuilder<TSchema, QueryElement<TSchema>, QueryElement<TSchema>[]>;

function wrap<TSchema extends ATS.AnyTypeSchema, TOutput, TResult, TParams extends Readonly<Record<string, unknown>>>(
  schema: TSchema,
  collection: ATS.ArraySchema<TSchema>,
  builder: QueryBuilder<ATS.ArraySchema<TSchema>, TOutput, TResult, TParams>
): CqrsQuery<TSchema, TOutput, TResult, TParams> {
  const program = getQueryProgram(builder);
  const record = builder as unknown as Record<string, unknown>;
  const filterMethod = record.filter as (
    ...args: unknown[]
  ) => QueryBuilder<ATS.ArraySchema<TSchema>, unknown, unknown>;
  const takeMethod = record.take as (...args: unknown[]) => QueryBuilder<ATS.ArraySchema<TSchema>, unknown, unknown>;
  const chainMethods = [
    "params",
    "authorize",
    "filter",
    "select",
    "unique",
    "distinct",
    "keyed",
    "groupBy",
    "orderBy",
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
    "delete",
    "update",
    "sum",
    "count",
    "avg",
    "min",
    "max",
    "aggregate",
    "first",
    "findIndex",
    "some",
    "every",
  ] as const;

  for (const key of chainMethods) {
    const method = record[key] as (...args: unknown[]) => QueryBuilder<ATS.ArraySchema<TSchema>, unknown, unknown>;

    Object.defineProperty(builder, key, {
      value: (...args: unknown[]) => wrap(schema, collection, method(...args)),
    });
  }

  Object.defineProperties(builder, {
    join: {
      value: (right: SchemaInput, kind: QueryJoinKind = "inner") =>
        createJoinOnBuilder(schema, collection, program, right, kind),
    },
    where: {
      value: (...args: unknown[]) => wrap(schema, collection, filterMethod(...args)),
    },
    limit: {
      value: (count: number) => wrap(schema, collection, takeMethod(count)),
    },
    "~query": {
      get: () =>
        Object.freeze({
          version: 1 as const,
          definition: toStandardQuery(schema, program),
        }),
    },
  });
  if (program)
    registerArtifact(builder, {
      kind: "query-plan",
      schema: collection,
      program,
      mode: "array",
      standard: (builder as unknown as CqrsQuery<TSchema>)["~query"],
    });
  return builder as unknown as CqrsQuery<TSchema, TOutput, TResult, TParams>;
}

function createJoinOnBuilder<
  TLeftSchema extends ATS.AnyTypeSchema,
  TRightSchema extends ATS.AnyTypeSchema,
  TKind extends QueryJoinKind,
  TParams extends Readonly<Record<string, unknown>>,
>(
  leftSchema: TLeftSchema,
  leftCollection: ATS.ArraySchema<TLeftSchema>,
  program: import("../compiler/query.js").QueryProgram | undefined,
  rightInput: SchemaInput<TRightSchema>,
  kind: TKind
): CqrsJoinOnBuilder<TLeftSchema, TRightSchema, TKind, TParams> {
  if (!program) throw new JITError("INVALID_QUERY", "join requires a reconstructive query program");
  if (kind !== "inner" && kind !== "left" && kind !== "semi" && kind !== "anti") {
    throw new JITError("INVALID_QUERY", `unsupported join kind ${JSON.stringify(kind)}`);
  }
  const target = unwrapSchema(rightInput);
  const rightSchema = (
    target.type === "array" ? (target as ATS.ArraySchema<TRightSchema>).def.element : target
  ) as TRightSchema;
  const rightCollection =
    target.type === "array"
      ? (target as ATS.ArraySchema<TRightSchema>)
      : (array(rightSchema).schema as ATS.ArraySchema<TRightSchema>);

  return Object.freeze({
    on(leftKey: string, rightKey: string) {
      const plan = createJoinPlan(leftCollection, rightCollection, program, kind, leftKey, rightKey);
      type Result = JoinResult<Row<TLeftSchema>, Row<TRightSchema>, TKind>;
      let compiled: ReturnType<typeof compileJoin<Row<TLeftSchema>, Row<TRightSchema>, Result, TParams>> | undefined;
      const callable = function join(
        left: readonly Row<TLeftSchema>[],
        right: readonly Row<TRightSchema>[],
        params?: TParams
      ): Result {
        compiled ??= compileJoin<Row<TLeftSchema>, Row<TRightSchema>, Result, TParams>(plan);
        return compiled(left, right, params);
      } as CqrsJoinedQuery<TLeftSchema, TRightSchema, TKind, TParams>;
      const standard: StandardQuery = Object.freeze({
        version: 1,
        definition: Object.freeze({
          ...toStandardQuery(leftSchema, program),
          pipeline: Object.freeze([
            ...toStandardQuery(leftSchema, program).pipeline,
            Object.freeze({
              kind: "join" as const,
              join: kind,
              source: Object.freeze({
                kind: "object" as const,
                fields: Object.freeze(objectFields(rightSchema)),
              }),
              leftKey,
              rightKey,
            }),
          ]),
        }),
      });
      Object.defineProperties(callable, {
        explain: { value: () => explainJoinPlan(plan) },
        "~query": { value: standard },
      });
      registerArtifact(callable, { kind: "join-plan", plan, standard });
      return callable;
    },
  }) as CqrsJoinOnBuilder<TLeftSchema, TRightSchema, TKind, TParams>;
}

function toStandardQuery(
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
      return Object.freeze({
        kind: "where",
        condition: toStandardCondition(node.condition, bindings),
      });
    case "select:fields":
      return Object.freeze({
        kind: "select",
        fields: Object.freeze([...node.fields]),
      });
    case "distinct":
      return Object.freeze({
        kind: "distinct",
        fields: Object.freeze([...node.fields]),
      });
    case "orderBy":
      return Object.freeze({
        kind: "orderBy",
        key: node.key,
        direction: node.direction,
      });
    case "unique":
    case "keyed":
    case "groupBy":
    case "flatMap":
    case "groupAdjacentBy":
      return Object.freeze({ kind: node.kind, key: node.key });
    case "take":
    case "drop":
      return Object.freeze({ kind: node.kind, count: node.count });
    case "takeWhile":
    case "dropWhile":
      return Object.freeze({
        kind: node.kind,
        condition: toStandardCondition(node.condition, bindings),
      });
    case "chunk":
    case "window":
      return Object.freeze({ kind: node.kind, size: node.size });
    case "pairwise":
    case "delete":
      return Object.freeze({ kind: node.kind });
    case "scan":
      return Object.freeze({
        kind: "scan",
        initial: toStandardValue({ kind: "binding", name: node.initialBinding }, bindings),
        update: Object.freeze({
          kind: "binding" as const,
          name: node.updateBinding,
        }),
      });
    case "update":
      return Object.freeze({
        kind: "update",
        patch: Object.freeze(
          Object.fromEntries(Object.entries(node.patch).map(([key, value]) => [key, toStandardValue(value, bindings)]))
        ),
      });
    case "aggregate":
      return Object.freeze({
        kind: "aggregate",
        operation: node.op,
        ...(node.key === undefined ? {} : { key: node.key }),
      });
    case "terminal":
      return Object.freeze({ kind: "terminal", operation: node.op });
    case "aggregate:composite":
      return Object.freeze({
        kind: "aggregate:composite",
        fields: Object.freeze(
          node.fields.map((field) =>
            Object.freeze({
              name: field.name,
              operation: field.op,
              ...(field.key === undefined ? {} : { key: field.key }),
            })
          )
        ),
      });
  }
}

function objectFields(schema: ATS.AnyTypeSchema): string[] {
  const object = schema.type === "runtimeType" ? (schema.def as ATS.RuntimeTypeDef).innerType : schema;
  return object.type === "object" ? Object.keys((object.def as ATS.ObjectDef).props) : [];
}

function isSchemaPath(schema: ATS.AnyTypeSchema, path: string): boolean {
  let current = schema;
  for (const key of path.split(".")) {
    if (current.type === "runtimeType") current = (current.def as ATS.RuntimeTypeDef).innerType;
    if (current.type !== "object") return false;
    const next = (current.def as ATS.ObjectDef).props[key];
    if (!next) return false;
    current = next;
  }
  return true;
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

export function cqrsInput<TSchema extends ATS.AnyTypeSchema>(
  schema: SchemaInput<TSchema>,
  options: CqrsInputOptions<TSchema>
): CqrsInput<TSchema> {
  const unwrapped = unwrapSchema(schema);
  if (unwrapped.type !== "object" && unwrapped.type !== "runtimeType") {
    throw new JITError("INVALID_QUERY", "JIT.api.query() requires an object or Runtime Type schema");
  }
  if (
    options.filter !== undefined &&
    (options.filter === null || typeof options.filter !== "object" || Array.isArray(options.filter))
  ) {
    throw new JITError("INVALID_QUERY", "API query filter configuration must be an object");
  }
  if (options.sort !== undefined && !Array.isArray(options.sort)) {
    throw new JITError("INVALID_QUERY", "API query sort configuration must be an array");
  }
  if (options.select !== undefined && typeof options.select !== "boolean") {
    throw new JITError("INVALID_QUERY", "API query select configuration must be boolean");
  }
  const maxFilters = options.maxFilters ?? 32;
  const fields = new Set(objectFields(unwrapped));
  for (const [field, operators] of Object.entries(options.filter ?? {})) {
    if (!isSchemaPath(unwrapped, field))
      throw new JITError(
        "INVALID_QUERY",
        `API query filter field ${JSON.stringify(field)} is not declared by the model`
      );
    if (operators !== true && !Array.isArray(operators)) {
      throw new JITError(
        "INVALID_QUERY",
        `API query filter field ${JSON.stringify(field)} has an invalid operator list`
      );
    }
    if (operators !== true) {
      if (operators.length === 0) {
        throw new JITError(
          "INVALID_QUERY",
          `API query filter field ${JSON.stringify(field)} has an empty operator list`
        );
      }
      const seen = new Set<string>();
      for (const operator of operators) {
        if (typeof operator !== "string" || operator.length === 0 || operator.startsWith("$")) {
          throw new JITError(
            "INVALID_QUERY",
            `API query filter field ${JSON.stringify(field)} has an invalid operator`
          );
        }
        if (seen.has(operator)) {
          throw new JITError(
            "INVALID_QUERY",
            `API query filter field ${JSON.stringify(field)} repeats operator ${JSON.stringify(operator)}`
          );
        }
        seen.add(operator);
      }
    }
  }
  const seenSort = new Set<string>();
  for (const field of options.sort ?? []) {
    if (!fields.has(field))
      throw new JITError("INVALID_QUERY", `API query sort field ${JSON.stringify(field)} is not declared by the model`);
    if (seenSort.has(field))
      throw new JITError("INVALID_QUERY", `API query sort configuration repeats ${JSON.stringify(field)}`);
    seenSort.add(field);
  }
  if (!Number.isSafeInteger(maxFilters) || maxFilters < 0) {
    throw new JITError("INVALID_QUERY", "API query maxFilters must be a non-negative safe integer");
  }
  for (const value of [options.limits?.maxConditions, options.limits?.maxSortFields, options.limits?.maxSelectFields]) {
    if (value !== undefined && (!Number.isSafeInteger(value) || value < 0)) {
      throw new JITError("INVALID_QUERY", "API query structural limits must be non-negative safe integers");
    }
  }
  if (options.pagination) {
    const { defaultLimit, maxLimit } = options.pagination;
    if (
      !Number.isSafeInteger(defaultLimit) ||
      !Number.isSafeInteger(maxLimit) ||
      defaultLimit < 1 ||
      maxLimit < defaultLimit
    ) {
      throw new JITError("INVALID_QUERY", "API query pagination requires positive bounded limits");
    }
    if (options.pagination.type === "cursor" && options.pagination.by.length === 0) {
      throw new JITError("INVALID_QUERY", "API query cursor pagination requires at least one stable ordering field");
    }
    if (options.pagination.type === "cursor") {
      const seen = new Set<string>();
      for (const field of options.pagination.by) {
        if (!fields.has(field))
          throw new JITError(
            "INVALID_QUERY",
            `API query cursor field ${JSON.stringify(field)} is not declared by the model`
          );
        if (seen.has(field))
          throw new JITError("INVALID_QUERY", `API query cursor ordering repeats ${JSON.stringify(field)}`);
        seen.add(field);
      }
    }
  }
  const frozenFilter = Object.freeze(
    Object.fromEntries(
      Object.entries(options.filter ?? {}).map(([field, allowed]) => [
        field,
        allowed === true ? true : Object.freeze([...(allowed as readonly string[])]),
      ])
    )
  ) as CqrsInputOptions<TSchema>["filter"];
  const frozenSort = Object.freeze([...(options.sort ?? [])]) as CqrsInputOptions<TSchema>["sort"];
  const frozenPagination = options.pagination
    ? Object.freeze(
        options.pagination.type === "cursor"
          ? {
              ...options.pagination,
              by: Object.freeze([...options.pagination.by]),
            }
          : { ...options.pagination }
      )
    : undefined;
  const frozenLimits = options.limits ? Object.freeze({ ...options.limits }) : undefined;
  const frozenOptions = Object.freeze({
    ...options,
    ...(frozenFilter === undefined ? {} : { filter: frozenFilter }),
    ...(frozenSort === undefined ? {} : { sort: frozenSort }),
    ...(frozenPagination === undefined ? {} : { pagination: frozenPagination }),
    ...(frozenLimits === undefined ? {} : { limits: frozenLimits }),
  }) as CqrsInputOptions<TSchema>;
  const definition: StandardQueryInput["definition"] = Object.freeze({
    source: Object.freeze({
      kind: "object" as const,
      fields: Object.freeze(objectFields(unwrapped)),
    }),
    filters: frozenFilter as Readonly<Record<string, true | readonly string[]>>,
    projection: frozenOptions.select === true,
    sorting: frozenSort as readonly string[],
    ...(frozenPagination
      ? {
          pagination: Object.freeze({
            ...frozenPagination,
            ...(frozenPagination.type === "cursor" ? { by: Object.freeze([...frozenPagination.by]) } : {}),
          }),
        }
      : {}),
    limits: Object.freeze({
      maxConditions: frozenOptions.limits?.maxConditions ?? maxFilters,
      maxSortFields: frozenOptions.limits?.maxSortFields ?? 3,
      maxSelectFields: frozenOptions.limits?.maxSelectFields ?? 30,
    }),
  });
  const input = Object.freeze({
    schema: unwrapped,
    options: frozenOptions,
    "~query": Object.freeze({ version: 1 as const, definition }),
  });
  registerArtifact(input, {
    kind: "cqrs-input",
    definition,
    source: emitCqrsAotParserSource(
      Object.entries(frozenOptions.filter ?? {}) as [string, true | readonly string[]][],
      frozenOptions.maxFilters ?? 32,
      frozenOptions.sort ?? [],
      frozenOptions.pagination,
      frozenOptions.limits?.maxConditions ?? frozenOptions.maxFilters ?? 32,
      frozenOptions.limits?.maxSortFields ?? 3,
      frozenOptions.select ? objectFields(unwrapped) : [],
      frozenOptions.limits?.maxSelectFields ?? 30
    ),
  });
  return input;
}

/** Reference normalizer for dynamic input; later lowered to specialized source. */
export function cqrsParse<TSchema extends ATS.AnyTypeSchema>(definition: CqrsInput<TSchema>) {
  const reference = cqrsParseReference(definition);
  const fields = Object.entries(definition.options.filter ?? {}) as [string, true | readonly string[]][];
  const source = emitCqrsInputParser(
    fields,
    definition.options.maxFilters ?? 32,
    definition.options.sort ?? [],
    definition.options.pagination,
    definition.options.limits?.maxConditions ?? definition.options.maxFilters ?? 32,
    definition.options.limits?.maxSortFields ?? 3,
    definition.options.select ? objectFields(definition.schema) : [],
    definition.options.limits?.maxSelectFields ?? 30
  );
  const parser = globalThis.Function("__reference", "__decodeCursor", source)(reference, decodeCqrsCursor) as (
    input: unknown
  ) => ParsedCqrsInput;
  const artifact = getArtifact(definition);
  if (artifact?.kind === "cqrs-input") {
    registerArtifact(parser, {
      kind: "cqrs-parser",
      definition: artifact.definition,
      source: artifact.source,
    });
  }
  return parser;
}

function cqrsParseReference<TSchema extends ATS.AnyTypeSchema>(definition: CqrsInput<TSchema>) {
  return (input: unknown): ParsedCqrsInput => {
    if (input === null || typeof input !== "object" || Array.isArray(input)) {
      throw new JITError("INVALID_QUERY", "API query input must be an object");
    }
    const source = input as Record<string, unknown>;
    const allowedInputKeys = new Set([
      "filter",
      "fields",
      "sort",
      ...(definition.options.pagination?.type === "offset" ? ["page", "limit"] : []),
      ...(definition.options.pagination?.type === "cursor" ? ["after", "before", "limit"] : []),
    ]);
    for (const key of Object.keys(source)) {
      if (!allowedInputKeys.has(key)) {
        throw new JITError("INVALID_QUERY", `API query input field ${JSON.stringify(key)} is not allowed`);
      }
    }
    const filter = source.filter;
    if (filter === undefined) return normalizeCqrsTail(source, definition, []);
    if (filter === null || typeof filter !== "object" || Array.isArray(filter)) {
      throw new JITError("INVALID_QUERY", "API query filter must be an object");
    }
    const allowed: Readonly<Record<string, true | readonly string[] | undefined>> = definition.options.filter ?? {};
    const entries = Object.entries(filter as Record<string, unknown>);
    if (entries.length > (definition.options.maxFilters ?? 32)) {
      throw new JITError("INVALID_QUERY", "API query filter exceeds the configured structural limit");
    }
    const conditions: CqrsInputCondition[] = [];
    for (const [field, raw] of entries) {
      const configured = allowed[field];
      if (configured === undefined)
        throw new JITError("INVALID_QUERY", `Filter field ${JSON.stringify(field)} is not allowed`);
      if (raw !== null && typeof raw === "object" && !Array.isArray(raw)) {
        if (configured === true) {
          throw new JITError("INVALID_QUERY", `Filter field ${JSON.stringify(field)} only allows equality`);
        }
        for (const [operator, value] of Object.entries(raw as Record<string, unknown>)) {
          const kind = operator.startsWith("$") ? operator.slice(1) : operator;
          if (!configured.includes(kind)) {
            throw new JITError(
              "INVALID_QUERY",
              `Filter operator ${JSON.stringify(kind)} is not allowed for ${JSON.stringify(field)}`
            );
          }
          conditions.push({ kind, path: field.split("."), value });
        }
      } else conditions.push({ kind: "eq", path: field.split("."), value: raw });
    }
    if (conditions.length > (definition.options.limits?.maxConditions ?? definition.options.maxFilters ?? 32)) {
      throw new JITError("INVALID_QUERY", "API query filter exceeds the configured condition limit");
    }
    return normalizeCqrsTail(source, definition, conditions);
  };
}

function normalizeCqrsTail<TSchema extends ATS.AnyTypeSchema>(
  source: Record<string, unknown>,
  definition: CqrsInput<TSchema>,
  filter: readonly CqrsInputCondition[]
): ParsedCqrsInput {
  const select = normalizeCqrsSelect(source, definition);
  const pagination = definition.options.pagination;
  const allowedSort = new Set<string>(pagination?.type === "cursor" ? pagination.by : (definition.options.sort ?? []));
  if (source.sort !== undefined && (typeof source.sort !== "string" || source.sort.length === 0)) {
    throw new JITError("INVALID_QUERY", "API query sort must be a non-empty string");
  }
  const sort =
    typeof source.sort === "string"
      ? source.sort.split(",").map((token) => {
          const descending = token.startsWith("-");
          const field = descending ? token.slice(1) : token;
          if (!allowedSort.has(field))
            throw new JITError("INVALID_QUERY", `Sort field ${JSON.stringify(field)} is not allowed`);
          return {
            path: [field],
            direction: descending ? ("desc" as const) : ("asc" as const),
          };
        })
      : [];
  const sortFields = new Set<string>();
  for (const entry of sort) {
    const field = entry.path[0] as string;
    if (field.length === 0) throw new JITError("INVALID_QUERY", "API query sort field cannot be empty");
    if (sortFields.has(field)) throw new JITError("INVALID_QUERY", `API query sort repeats ${JSON.stringify(field)}`);
    sortFields.add(field);
  }
  if (sort.length > (definition.options.limits?.maxSortFields ?? 3)) {
    throw new JITError("INVALID_QUERY", "API query sort exceeds the configured structural limit");
  }
  if (!pagination) return { filter, sort, ...(select === undefined ? {} : { select }) };
  if (pagination.type === "cursor") {
    if (sort.length > 0 && !sameCursorOrdering(sort, pagination.by)) {
      throw new JITError("INVALID_QUERY", "Cursor pagination requires its configured stable ordering");
    }
    const after = source.after === undefined ? undefined : decodeCqrsCursor(source.after, pagination.by.length);
    const before = source.before === undefined ? undefined : decodeCqrsCursor(source.before, pagination.by.length);
    if (after !== undefined && before !== undefined) {
      throw new JITError("INVALID_QUERY", "Cursor pagination accepts either after or before, not both");
    }
    const limit = typeof source.limit === "number" ? source.limit : pagination.defaultLimit;
    if (!Number.isInteger(limit) || limit < 1 || limit > pagination.maxLimit) {
      throw new JITError("INVALID_QUERY", "Invalid cursor pagination");
    }
    return {
      filter,
      sort: pagination.by.map((field) => ({
        path: [field],
        direction: "asc" as const,
      })),
      ...(select === undefined ? {} : { select }),
      pagination: {
        kind: "cursor",
        limit,
        ...(after === undefined ? {} : { after }),
        ...(before === undefined ? {} : { before }),
      },
    };
  }
  const page = typeof source.page === "number" ? source.page : 1;
  const limit = typeof source.limit === "number" ? source.limit : pagination.defaultLimit;
  const offset = (page - 1) * limit;
  if (
    !Number.isSafeInteger(page) ||
    page < 1 ||
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > pagination.maxLimit ||
    !Number.isSafeInteger(offset)
  ) {
    throw new JITError("INVALID_QUERY", "Invalid offset pagination");
  }
  return {
    filter,
    sort,
    ...(select === undefined ? {} : { select }),
    pagination: { kind: "offset", offset, limit },
  };
}

function normalizeCqrsSelect<TSchema extends ATS.AnyTypeSchema>(
  source: Record<string, unknown>,
  definition: CqrsInput<TSchema>
): readonly string[] | undefined {
  if (source.fields === undefined) return undefined;
  if (!definition.options.select || typeof source.fields !== "string") {
    throw new JITError("INVALID_QUERY", "API query sparse fields are not allowed");
  }
  if (source.fields.length === 0) throw new JITError("INVALID_QUERY", "API query select field cannot be empty");
  const fields = source.fields.split(",");
  if (fields.length > (definition.options.limits?.maxSelectFields ?? 30)) {
    throw new JITError("INVALID_QUERY", "API query select exceeds the configured structural limit");
  }
  const allowed = new Set(objectFields(definition.schema));
  const selected = new Set<string>();
  for (const field of fields) {
    if (field.length === 0) throw new JITError("INVALID_QUERY", "API query select field cannot be empty");
    if (!allowed.has(field))
      throw new JITError("INVALID_QUERY", `Select field ${JSON.stringify(field)} is not allowed`);
    if (selected.has(field)) throw new JITError("INVALID_QUERY", `API query select repeats ${JSON.stringify(field)}`);
    selected.add(field);
  }
  return fields;
}

function sameCursorOrdering(
  sort: readonly {
    readonly path: readonly string[];
    readonly direction: "asc" | "desc";
  }[],
  fields: readonly string[]
): boolean {
  return (
    sort.length === fields.length &&
    sort.every((entry, index) => entry.direction === "asc" && entry.path[0] === fields[index])
  );
}

/** Encodes a JSON-safe cursor tuple. The tuple shape is validated by the parser that owns it. */
export function encodeCqrsCursor(values: readonly unknown[]): string {
  return globalThis.btoa(
    encodeURIComponent(JSON.stringify(values)).replace(/%([0-9A-F]{2})/g, (_, hex: string) =>
      String.fromCharCode(Number.parseInt(hex, 16))
    )
  );
}

function decodeCqrsCursor(value: unknown, size: number): readonly unknown[] {
  if (typeof value !== "string") throw new JITError("INVALID_QUERY", "Cursor must be an opaque string");
  try {
    const bytes = globalThis.atob(value);
    let escaped = "";
    for (let index = 0; index < bytes.length; index++)
      escaped += `%${bytes.charCodeAt(index).toString(16).padStart(2, "0")}`;
    const decoded: unknown = JSON.parse(decodeURIComponent(escaped));
    if (!Array.isArray(decoded) || decoded.length !== size) throw new Error("Invalid cursor tuple");
    return decoded;
  } catch {
    throw new JITError("INVALID_QUERY", "Malformed cursor");
  }
}

export function emitCqrsInputParser(
  fields: readonly [string, true | readonly string[]][],
  maxFilters: number,
  sortFields: readonly string[] = [],
  pagination?: CqrsPagination,
  maxConditions = maxFilters,
  maxSortFields = 3,
  selectFields: readonly string[] = [],
  maxSelectFields = 30
): string {
  const allowedFields = fields.map(([field]) => JSON.stringify(field));
  const inputFields = [
    "filter",
    "fields",
    "sort",
    ...(pagination?.type === "offset" ? ["page", "limit"] : []),
    ...(pagination?.type === "cursor" ? ["after", "before", "limit"] : []),
  ].map((field) => JSON.stringify(field));
  const conditionCapacity = Math.max(
    1,
    ...fields.map(([, configured]) => (configured === true ? 1 : configured.length * 2))
  );
  const fieldBodies = fields.map(([field, configured]) => {
    const access = `[${JSON.stringify(field)}]`;
    const operators = configured === true ? [] : configured;
    const operatorBodies = operators
      .flatMap((operator) => {
        const kind = JSON.stringify(operator);
        const path = JSON.stringify(field.split("."));
        return [
          `if (raw[${JSON.stringify(`$${operator}`)}] !== undefined) { matched += 1; out[j++] = { kind: ${kind}, path: ${path}, value: raw[${JSON.stringify(`$${operator}`)}] }; }`,
          `if (raw[${JSON.stringify(operator)}] !== undefined) { matched += 1; out[j++] = { kind: ${kind}, path: ${path}, value: raw[${JSON.stringify(operator)}] }; }`,
        ];
      })
      .join(" ");
    return `if (filter${access} !== undefined) { const raw = filter${access}; if (raw !== null && typeof raw === "object" && !Array.isArray(raw)) { ${operatorBodies ? `let matched = 0; ${operatorBodies} if (Object.keys(raw).length !== matched) return __reference(input);` : "return __reference(input);"} } else out[j++] = { kind: "eq", path: ${JSON.stringify(field.split("."))}, value: raw }; }`;
  });
  const allowedSort = sortFields.map((field) => JSON.stringify(field));
  const allowedSelect = selectFields.map((field) => JSON.stringify(field));
  const selectSource = `const selectText = input.fields; let select; if (selectText !== undefined) { if (typeof selectText !== "string" || selectText.length === 0) return __reference(input); const selected = selectText.split(","); if (selected.length > ${maxSelectFields}) return __reference(input); const seen = new Set(); for (let i = 0; i < selected.length; i++) { const field = selected[i]; if (field.length === 0 || seen.has(field) || (${allowedSelect.map((field) => `field !== ${field}`).join(" && ") || "true"})) return __reference(input); seen.add(field); } select = selected; }`;
  const sortSource = `const sortText = input.sort; let sort = []; if (sortText !== undefined) { if (typeof sortText !== "string" || sortText.length === 0) return __reference(input); const tokens = sortText.split(","); if (tokens.length > ${maxSortFields}) return __reference(input); const seen = new Set(); sort = new Array(tokens.length); for (let i = 0; i < tokens.length; i++) { const token = tokens[i]; const descending = token.charCodeAt(0) === 45; const field = descending ? token.slice(1) : token; if (field.length === 0 || seen.has(field) || (${allowedSort.map((field) => `field !== ${field}`).join(" && ") || "true"})) return __reference(input); seen.add(field); sort[i] = { path: [field], direction: descending ? "desc" : "asc" }; } }`;
  const paginationSource = !pagination
    ? "return select === undefined ? { filter: out, sort } : { filter: out, sort, select };"
    : pagination.type === "offset"
      ? `const page = typeof input.page === "number" ? input.page : 1; const limit = typeof input.limit === "number" ? input.limit : ${pagination.defaultLimit}; const offset = (page - 1) * limit; if (!Number.isSafeInteger(page) || page < 1 || !Number.isSafeInteger(limit) || limit < 1 || limit > ${pagination.maxLimit} || !Number.isSafeInteger(offset)) return __reference(input); return select === undefined ? { filter: out, sort, pagination: { kind: "offset", offset, limit } } : { filter: out, sort, select, pagination: { kind: "offset", offset, limit } };`
      : `if (typeof sortText === "string" && sortText.length > 0 && sortText !== ${JSON.stringify(pagination.by.join(","))}) return __reference(input); sort = ${JSON.stringify(pagination.by.map((field) => ({ path: [field], direction: "asc" })))}; const afterText = input.after; const beforeText = input.before; if (afterText !== undefined && beforeText !== undefined) return __reference(input); const after = afterText === undefined ? undefined : __decodeCursor(afterText, ${pagination.by.length}); const before = beforeText === undefined ? undefined : __decodeCursor(beforeText, ${pagination.by.length}); const limit = typeof input.limit === "number" ? input.limit : ${pagination.defaultLimit}; if (!Number.isInteger(limit) || limit < 1 || limit > ${pagination.maxLimit}) return __reference(input); return select === undefined ? { filter: out, sort, pagination: { kind: "cursor", limit, ...(after === undefined ? {} : { after }), ...(before === undefined ? {} : { before }) } } : { filter: out, sort, select, pagination: { kind: "cursor", limit, ...(after === undefined ? {} : { after }), ...(before === undefined ? {} : { before }) } };`;
  return `return function parse(input) { if (input === null || typeof input !== "object" || Array.isArray(input)) return __reference(input); const inputKeys = Object.keys(input); for (let i = 0; i < inputKeys.length; i++) { if (${inputFields.map((field) => `inputKeys[i] !== ${field}`).join(" && ") || "true"}) return __reference(input); } let out; if (input.filter === undefined) out = []; else { const filter = input.filter; if (filter === null || typeof filter !== "object" || Array.isArray(filter)) return __reference(input); const keys = Object.keys(filter); if (keys.length > ${maxFilters}) return __reference(input); for (let i = 0; i < keys.length; i++) { if (${allowedFields.map((field) => `keys[i] !== ${field}`).join(" && ") || "true"}) return __reference(input); } out = new Array(keys.length * ${conditionCapacity}); let j = 0; ${fieldBodies.join(" ")} if (j > ${maxConditions}) return __reference(input); if (j !== out.length) out.length = j; } ${selectSource} ${sortSource} ${paginationSource} };`;
}

/** Import-free variant consumed by the AOT emitter; invalid syntax throws directly. */
export function emitCqrsAotParserSource(...args: Parameters<typeof emitCqrsInputParser>): string {
  const parser = emitCqrsInputParser(...args)
    .split("return __reference(input);")
    .join('throw new Error("Invalid API query input");')
    .split("__decodeCursor")
    .join("decodeCursor");
  return `function decodeCursor(value, size) { if (typeof value !== "string") throw new Error("Malformed cursor"); try { const bytes = atob(value); let escaped = ""; for (let i = 0; i < bytes.length; i++) escaped += "%" + bytes.charCodeAt(i).toString(16).padStart(2, "0"); const decoded = JSON.parse(decodeURIComponent(escaped)); if (!Array.isArray(decoded) || decoded.length !== size) throw new Error("Malformed cursor"); return decoded; } catch { throw new Error("Malformed cursor"); } } ${parser}`;
}

/**
 * One reduction inside a composite aggregate. The phantom `_result` carries
 * the field's result type; it is `null` at runtime, like every other phantom
 * in the schema AST.
 */
export interface CqrsAggregateSpec<TResult = number> {
  readonly op: QueryAggregateOperator;
  readonly key?: string;
  readonly _result: TResult;
}

function aggregateSpec<TResult>(op: QueryAggregateOperator, key?: string): CqrsAggregateSpec<TResult> {
  return Object.freeze({
    op,
    ...(key === undefined ? {} : { key }),
    _result: null as TResult,
  });
}

export const cqrs = Object.freeze({
  query: cqrsQuery,
  param,
  const: constant,
  /** Counts the rows that reach the aggregate; `0` when none do. */
  count: () => aggregateSpec<number>("count"),
  /** Sums a numeric field; `0` when no row reaches the aggregate. */
  sum: (key: string) => aggregateSpec<number>("sum", key),
  /** Averages a numeric field; `undefined` when no row reaches the aggregate. */
  avg: (key: string) => aggregateSpec<number | undefined>("avg", key),
  min: (key: string) => aggregateSpec<number | undefined>("min", key),
  max: (key: string) => aggregateSpec<number | undefined>("max", key),
});
