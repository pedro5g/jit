import { type BinaryArray, type BinaryRowSet, isBinaryArray, isBinaryRowSet } from "../compiler/binary-rowset.js";
import { compileJoin, createJoinPlan, explainJoinPlan, type JoinPair, type LeftJoinPair } from "../compiler/join.js";
import type { QueryJoinKind } from "../core/ast/index.js";
import type * as ATS from "../core/ats/index.js";
import type { SchemaInput } from "../core/builder/index.js";
import { unwrapSchema } from "../core/builder/index.js";
import { JITError } from "../errors/index.js";
import { registerArtifact } from "../runtime/artifact-registry.js";
import { array } from "./collection/collection.js";
import type { CqrsJoinedQuery, CqrsJoinOnBuilder, CqrsQuery, StandardQuery } from "./cqrs.js";
import { objectFields, toStandardQuery } from "./cqrs-standard.js";
import { type BinaryQueryBuilder, query as createQuery, getQueryProgram, type QueryBuilder } from "./query.js";

type Row<TSchema extends ATS.AnyTypeSchema> = ATS.TypeofSchema<TSchema>;
type JoinResult<TLeft, TRight, TKind extends QueryJoinKind> = TKind extends "semi" | "anti"
  ? TLeft[]
  : TKind extends "left"
    ? LeftJoinPair<TLeft, TRight>[]
    : JoinPair<TLeft, TRight>[];

export function cqrsQuery<TElement>(
  target: BinaryArray<TElement> | BinaryRowSet<TElement>
): BinaryQueryBuilder<TElement, TElement, TElement[]>;
export function cqrsQuery<TSchema extends ATS.AnyTypeSchema>(schema: SchemaInput<TSchema>): CqrsQueryFor<TSchema>;
/** Provides the JIT cqrs query operation for the supplied input. */
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

/** Describes the JIT cqrs query for contract used by the public API. */
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
