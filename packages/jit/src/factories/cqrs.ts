import { resolveAccessContext } from "../compiler/access.js";
import { emitApiAuthorizationBody, resolveApiAuthorization } from "../compiler/api-authorization.js";
import type { explainJoinPlan, JoinPair, LeftJoinPair } from "../compiler/join.js";
import type { QueryBoundary } from "../compiler/query-boundary.js";
import type { QueryBoundaryExplanation } from "../compiler/query-cost.js";
import type {
  QueryAggregateOperator,
  QueryCompareOperator,
  QueryConditionNode,
  QueryJoinKind,
  QueryOperatorsFor,
} from "../core/ast/index.js";
import type * as ATS from "../core/ats/index.js";
import type { SchemaInput } from "../core/builder/index.js";
import { AccessDeniedError, JITError } from "../errors/index.js";
import { type CompiledArtifact, getArtifact, registerArtifact } from "../runtime/artifact-registry.js";
import { createCqrsInput } from "./cqrs-input.js";
import {
  cqrsParseReference,
  decodeCqrsCursor,
  emitCqrsAotParserSource,
  emitCqrsInputParser,
  getCqrsBoundary,
  registerCqrsBoundary,
} from "./cqrs-parser.js";
import { cqrsQuery } from "./cqrs-query.js";
import {
  constant,
  type LazyQueryBuilder,
  param,
  type QueryBuilder,
  type QueryConditionBuilder,
  type QueryRuntimeParams,
  type QuerySinks,
} from "./query.js";
import type { RulePredicate } from "./rules.js";

/**
 * Portable V1 query envelope emitted by a trusted CQRS query.
 *
 * @example
 * ```ts
 * const query = JIT.cqrs.query(Users).filter((where) => where.eq("active", true));
 * const portable: JIT.StandardQuery = query["~query"];
 * ```
 */
export interface StandardQuery {
  readonly version: 1;
  readonly definition: StandardQueryDefinition;
}

/**
 * Portable V1 description; deliberately independent from JIT's execution IR.
 *
 * @example
 * ```ts
 * const definition: JIT.StandardQueryDefinition = {
 *   source: { kind: "object", fields: ["id"] },
 *   pipeline: [],
 *   params: [],
 * };
 * ```
 */
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

/**
 * One semantic step in a portable query pipeline.
 *
 * @example
 * ```ts
 * const step: JIT.StandardQueryStep = { kind: "select", fields: ["id"] };
 * ```
 */
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

/**
 * A field, literal, binding or request parameter used by a portable query.
 *
 * @example
 * ```ts
 * const value: JIT.StandardQueryValue = { kind: "field", path: ["id"] };
 * ```
 */
export type StandardQueryValue =
  | { readonly kind: "field"; readonly path: readonly string[] }
  | { readonly kind: "literal"; readonly value: unknown }
  | { readonly kind: "binding"; readonly name: string }
  | { readonly kind: "param"; readonly name: string };

/**
 * A portable comparison or logical query condition.
 *
 * @example
 * ```ts
 * const condition: JIT.StandardQueryCondition = {
 *   kind: "compare",
 *   operator: "eq",
 *   left: { kind: "field", path: ["id"] },
 *   right: { kind: "literal", value: 1 },
 * };
 * ```
 */
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

type QueryBoundaryOperators<TValue> = [QueryOperatorsFor<TValue>] extends [never]
  ? never
  : true | readonly QueryOperatorsFor<TValue>[];

/**
 * Describes the allowlist and structural budgets for a public query boundary.
 *
 * @example
 * ```ts
 * const options: JIT.CqrsInputOptions<typeof Users.schema> = {
 *   select: ["id"],
 *   filter: { active: true },
 *   limits: { maxConditions: 4 },
 * };
 * ```
 */
export interface CqrsInputOptions<TSchema extends ATS.AnyTypeSchema> {
  readonly filter?: Partial<{
    readonly [TKey in Extract<keyof ATS.TypeofSchema<TSchema>, string>]: QueryBoundaryOperators<
      ATS.TypeofSchema<TSchema>[TKey]
    >;
  }> &
    Partial<
      Record<`${Extract<keyof ATS.TypeofSchema<TSchema>, string>}.${string}`, true | readonly QueryCompareOperator[]>
    >;
  readonly select?: readonly Extract<keyof ATS.TypeofSchema<TSchema>, string>[];
  readonly sort?: readonly Extract<keyof ATS.TypeofSchema<TSchema>, string>[];
  readonly pagination?:
    | {
        readonly type: "offset";
        readonly defaultLimit: number;
        readonly maxLimit: number;
        /** Largest computed offset a request may reach; defaults to 10000. */
        readonly maxOffset?: number;
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
    /** Last global stop for declared traversal depth; defaults to 3. */
    readonly maxDepth?: number;
    /** Semantic complexity budget; defaults to what the other limits already allow. */
    readonly maxCost?: number;
  };
}

/**
 * A deny-by-default request boundary and its portable query metadata.
 *
 * @example
 * ```ts
 * const boundary = JIT.api.query(Users, { select: ["id"] });
 * boundary.explain().cost;
 * ```
 */
export interface CqrsInput<TSchema extends ATS.AnyTypeSchema> {
  readonly schema: TSchema;
  readonly options: CqrsInputOptions<TSchema>;
  readonly "~query": StandardQueryInput;
  /** Reports what the boundary permits and what it costs, without running a request. */
  explain(): QueryBoundaryExplanation;
}

/** Offset pagination is bounded by default; deep pages are the common amplification. */

/**
 * Structural dynamic-query definition that adapters may inspect without importing JIT.
 *
 * @example
 * ```ts
 * const portable: JIT.StandardQueryInput = boundary["~query"];
 * portable.version; // 1
 * ```
 */
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
/**
 * One parsed request condition at the public query boundary.
 *
 * @example
 * ```ts
 * const parsed = JIT.api.parse(boundary)({ filter: { active: true } });
 * const condition: JIT.CqrsInputCondition | undefined = parsed.filter[0];
 * ```
 */
export interface CqrsInputCondition {
  readonly kind: string;
  readonly path: readonly string[];
  readonly value: unknown;
}
/**
 * One request after the boundary and the actor's access have both been applied.
 *
 * The filter is the portable condition of the V1 protocol: the request's own
 * predicate and the actor's row predicate joined with `and`. No access node
 * crosses this boundary — an adapter receives an ordinary query.
 *
 * @example
 * ```ts
 * const authorize = JIT.api.authorize(boundary, ability, "read");
 * const request: JIT.AuthorizedApiRequest = authorize({ select: ["id"] });
 * ```
 */
export interface AuthorizedApiRequest {
  readonly filter?: StandardQueryCondition;
  readonly select?: readonly string[];
  readonly sort: readonly {
    readonly path: readonly string[];
    readonly direction: "asc" | "desc";
  }[];
  readonly pagination?: ParsedCqrsInput["pagination"];
}

/**
 * Parsed and normalized request input produced by a CQRS boundary.
 *
 * @example
 * ```ts
 * const parsed: JIT.ParsedCqrsInput = JIT.api.parse(boundary)({ select: ["id"] });
 * parsed.select; // ["id"]
 * ```
 */
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

/**
 * Selects compatible fields for a typed collection join.
 *
 * @example
 * ```ts
 * const join = JIT.cqrs.query(Orders).join(Customers).on("customerId", "id");
 * join(orders, customers);
 * ```
 */
export interface CqrsJoinOnBuilder<
  TLeftSchema extends ATS.AnyTypeSchema,
  TRightSchema extends ATS.AnyTypeSchema,
  TKind extends QueryJoinKind,
  TParams extends Readonly<Record<string, unknown>>,
> {
  /** Selects the compatible key pair used by the join. */
  on<
    TLeftKey extends CqrsKey<TLeftSchema>,
    TRightKey extends CompatibleJoinKey<TRightSchema, Row<TLeftSchema>[TLeftKey]>,
  >(leftKey: TLeftKey, rightKey: TRightKey): CqrsJoinedQuery<TLeftSchema, TRightSchema, TKind, TParams>;
}

/**
 * Compiled join over two collection inputs.
 *
 * @example
 * ```ts
 * const join = JIT.cqrs.query(Orders).join(Customers).on("customerId", "id");
 * const pairs = join(orders, customers);
 * ```
 */
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
/**
 * A typed CQRS query chain with portable output metadata.
 *
 * @example
 * ```ts
 * const activeIds = JIT.cqrs.query(Users)
 *   .filter((query) => query.eq("active", true))
 *   .select("id");
 * activeIds(users); // [{ id: 1 }, ...]
 * ```
 */
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

export { emitCqrsAotParserSource, emitCqrsInputParser, encodeCqrsCursor } from "./cqrs-parser.js";
export type { CqrsQueryFor } from "./cqrs-query.js";
/** Builds a typed CQRS query chain over a schema or a binary collection. */
export { cqrsQuery };

/**
 * Declares a deny-by-default query boundary for untrusted input.
 *
 * @example
 * ```ts
 * const boundary = JIT.api.query(Users, { select: ["id"], filter: { active: true } });
 * const parse = JIT.api.parse(boundary);
 * ```
 */
export function cqrsInput<TSchema extends ATS.AnyTypeSchema>(
  schema: SchemaInput<TSchema>,
  options: CqrsInputOptions<TSchema>
): CqrsInput<TSchema> {
  const result = createCqrsInput(schema, options, emitCqrsAotParserSource);
  registerCqrsBoundary(result.input, result.boundary);
  return result.input;
}

/**
 * Compiles a boundary parser for dynamic request input.
 *
 * @example
 * ```ts
 * const boundary = JIT.api.query(Users, { select: ["id"] });
 * const parsed = JIT.api.parse(boundary)({ select: ["id"] });
 * ```
 */
export function cqrsParse<TSchema extends ATS.AnyTypeSchema>(definition: CqrsInput<TSchema>) {
  const boundary = getCqrsBoundary(definition);
  if (!boundary) throw new JITError("INVALID_QUERY", "API query boundary is missing its semantic descriptor");
  const reference = cqrsParseReference(boundary);
  const source = emitCqrsInputParser(boundary);
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

/**
 * Compiles the effective request one actor may make of a public boundary.
 *
 * The plan resolves once: which fields the action can read, and the shape of
 * its row predicate. Only the actor's own values are read per request, so a
 * request costs one parse and one predicate construction rather than a walk
 * over the rule set.
 *
 * @example
 * ```ts
 * const authorize = JIT.api.authorize(boundary, ability, "read");
 * const request = authorize({ select: ["id"] });
 * ```
 */
export function cqrsAuthorize<TSchema extends ATS.AnyTypeSchema, TAction extends string, TActor>(
  definition: CqrsInput<TSchema>,
  ability:
    | import("./access.js").Ability<Row<TSchema>, TAction>
    | import("./access.js").AccessPlan<Row<TSchema>, TActor, TAction>,
  action: TAction
): (input: unknown, actor?: TActor) => AuthorizedApiRequest {
  const resolved = resolveCqrsAuthorization(definition, ability as object, action);
  const compiled = globalThis.Function(
    "__reference",
    "__decodeCursor",
    "__AccessDeniedError",
    ...resolved.artifact.bindingNames,
    emitCqrsAuthorizedParser(emitCqrsInputParser(resolved.boundary), resolved.authorization, action)
  )(cqrsParseReference(resolved.boundary), decodeCqrsCursor, AccessDeniedError, ...resolved.artifact.bindingValues) as (
    input: unknown,
    actor?: unknown
  ) => AuthorizedApiRequest;
  const bound = resolved.actor;
  const authorize =
    bound === undefined ? compiled : (input: unknown) => compiled(input, bound as Readonly<Record<string, unknown>>);
  registerArtifact(authorize, resolved.artifact);
  return authorize;
}

/**
 * The static half of `authorize`, shared by the runtime and define hosts.
 *
 * A define file must not compile, so the artifact it registers is produced
 * here rather than by executing the compiled parser.
 */
export function resolveCqrsAuthorization(
  definition: { readonly "~query": StandardQueryInput },
  ability: object,
  action: string
): {
  readonly boundary: QueryBoundary;
  readonly authorization: import("../compiler/api-authorization.js").ApiAuthorization;
  readonly actor: unknown;
  readonly artifact: Extract<CompiledArtifact, { readonly kind: "cqrs-authorized-parser" }>;
} {
  const boundary = getCqrsBoundary(definition);
  if (!boundary) throw new JITError("INVALID_QUERY", "API query boundary is missing its semantic descriptor");
  const context = resolveAccessContext(ability);
  if (!context) {
    throw new JITError("INVALID_QUERY", "JIT.api.authorize() requires an access plan or a compiled ability");
  }
  const definitionArtifact = getArtifact(definition);
  if (definitionArtifact?.kind !== "cqrs-input") {
    throw new JITError("INVALID_QUERY", "API query boundary is missing reconstructive parser metadata");
  }
  const authorization = resolveApiAuthorization(boundary, context.descriptor, action);
  return {
    boundary,
    authorization,
    actor: context.actor,
    artifact: Object.freeze({
      kind: "cqrs-authorized-parser" as const,
      definition: definitionArtifact.definition,
      source: emitCqrsAuthorizedParser(emitCqrsAotParserSource(boundary), authorization, action),
      bindingNames: Object.freeze(authorization.bindings.map((_, index) => `__q${index}`)),
      bindingValues: authorization.bindings,
    }),
  };
}

/** Wraps one specialized request parser with the actor intersection. */
export function emitCqrsAuthorizedParser(
  parserSource: string,
  authorization: import("../compiler/api-authorization.js").ApiAuthorization,
  action: string
): string {
  const parser = parserSource.replace("return function parse", "const parse = function parse");
  return `${parser} return function authorize(input, actor) { const request = parse(input); ${emitApiAuthorizationBody(
    authorization,
    action
  )} };`;
}

/**
 * One reduction inside a composite aggregate. The phantom `_result` carries
 * the field's result type; it is `null` at runtime, like every other phantom
 * in the schema AST.
 *
 * @example
 * ```ts
 * const spec: JIT.CqrsAggregateSpec<number> = { op: "sum", key: "amount", _result: null as never };
 * ```
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

/**
 * CQRS query, parameter and aggregate factories.
 *
 * @example
 * ```ts
 * const query = JIT.cqrs.query(Users).filter((where) => where.eq("active", true));
 * query(users);
 * ```
 */
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
