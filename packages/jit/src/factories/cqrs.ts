import { compileQueryArray, type LazyQueryProgram } from "../compiler/lazy-query.js";
import { compileQuery, type QueryProgram } from "../compiler/query.js";
import type { QueryConditionNode, QueryNode, QueryPipelineNode, QueryValueNode } from "../core/ast/index.js";
import type * as ATS from "../core/ats/index.js";
import type { SchemaInput } from "../core/builder/index.js";
import { unwrapSchema } from "../core/builder/index.js";
import { JITError } from "../errors/index.js";
import { registerArtifact } from "../runtime/artifact-registry.js";
import { array } from "./collection/collection.js";
import {
  query as createQuery,
  getQueryProgram,
  type QueryBuilder,
  type QueryConditionBuilder,
  type QueryRuntimeParams,
} from "./query.js";

export interface StandardQuery {
  readonly version: 1;
  readonly definition: StandardQueryDefinition;
}

/** Portable V1 description; deliberately independent from JIT's execution IR. */
export interface StandardQueryDefinition {
  readonly source: { readonly kind: "object"; readonly fields: readonly string[] };
  readonly filter?: StandardQueryCondition;
  readonly projection?: readonly string[];
  readonly order?: readonly { readonly path: readonly string[]; readonly direction: "asc" | "desc" }[];
  readonly limit?: number;
  readonly params: readonly string[];
}

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
    | { readonly type: "offset"; readonly defaultLimit: number; readonly maxLimit: number }
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
  | { readonly type: "offset"; readonly defaultLimit: number; readonly maxLimit: number }
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
    readonly source: { readonly kind: "object"; readonly fields: readonly string[] };
    readonly filters: Readonly<Record<string, true | readonly string[]>>;
    readonly projection: boolean;
    readonly sorting: readonly string[];
    readonly pagination?:
      | { readonly type: "offset"; readonly defaultLimit: number; readonly maxLimit: number }
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
    | { readonly kind: "offset"; readonly offset: number; readonly limit: number }
    | {
        readonly kind: "cursor";
        readonly limit: number;
        readonly after?: readonly unknown[];
        readonly before?: readonly unknown[];
      };
}

type Row<TSchema extends ATS.AnyTypeSchema> = ATS.TypeofSchema<TSchema>;
type ParamShape = Readonly<Record<string, SchemaInput>>;
type Params<TShape extends ParamShape> = {
  readonly [TKey in keyof TShape]: TShape[TKey] extends SchemaInput<infer TSchema> ? ATS.TypeofSchema<TSchema> : never;
};
export type CqrsQuery<
  TSchema extends ATS.AnyTypeSchema,
  TOutput = Row<TSchema>,
  TParams extends Readonly<Record<string, unknown>> = Readonly<Record<never, never>>,
> = ((value: Row<TSchema>[], params?: TParams) => TOutput[]) & {
  params<const TShape extends ParamShape>(shape: TShape): CqrsQuery<TSchema, TOutput, TParams & Params<TShape>>;
  where(
    predicate: (query: QueryConditionBuilder<Row<TSchema>>, params: QueryRuntimeParams<TParams>) => QueryConditionNode
  ): CqrsQuery<TSchema, TOutput, TParams>;
  select<const TFields extends readonly Extract<keyof Row<TSchema>, string>[]>(
    ...fields: TFields
  ): CqrsQuery<TSchema, Pick<Row<TSchema>, TFields[number]>, TParams>;
  orderBy(key: Extract<keyof Row<TSchema>, string>, direction?: "asc" | "desc"): CqrsQuery<TSchema, TOutput, TParams>;
  limit(count: number): CqrsQuery<TSchema, TOutput, TParams>;
  readonly "~query": StandardQuery;
};

export function cqrsQuery<TSchema extends ATS.AnyTypeSchema>(schema: SchemaInput<TSchema>): CqrsQuery<TSchema> {
  const row = unwrapSchema(schema);
  if (row.type !== "object" && row.type !== "runtimeType") {
    throw new JITError("INVALID_QUERY", "JIT.cqrs.query() requires an object or Runtime Type schema");
  }
  const collection = array(row).schema;
  return wrap(
    row,
    collection,
    createQuery(collection) as QueryBuilder<ATS.ArraySchema<TSchema>, Row<TSchema>, Row<TSchema>[]>
  );
}

function wrap<TSchema extends ATS.AnyTypeSchema, TOutput, TParams extends Readonly<Record<string, unknown>>>(
  schema: TSchema,
  collection: ATS.ArraySchema<TSchema>,
  builder: QueryBuilder<ATS.ArraySchema<TSchema>, TOutput, TOutput[], TParams>
): CqrsQuery<TSchema, TOutput, TParams> {
  const rawProgram = getQueryProgram(builder);
  const program = rawProgram ? normalizeCqrsProgram(rawProgram) : undefined;
  let compiled: ((value: Row<TSchema>[], params?: TParams) => TOutput[]) | undefined;
  const callable = ((value: Row<TSchema>[], params?: TParams) => {
    if (!program) return builder(value, params);
    compiled ??= hasIncrementalQueryNodes(program)
      ? (compileQueryArray<Row<TSchema>, TOutput, TParams>(collection, program as LazyQueryProgram) as (
          value: Row<TSchema>[],
          params?: TParams
        ) => TOutput[])
      : (compileQuery(collection, program) as (value: Row<TSchema>[], params?: TParams) => TOutput[]);
    return compiled(value, params);
  }) as CqrsQuery<TSchema, TOutput, TParams>;
  Object.defineProperties(callable, {
    params: {
      value: <TShape extends ParamShape>(shape: TShape) => wrap(schema, collection, builder.params(shape)),
    },
    where: {
      value: (
        predicate: (
          query: QueryConditionBuilder<Row<TSchema>>,
          params: QueryRuntimeParams<TParams>
        ) => QueryConditionNode
      ) => wrap(schema, collection, builder.filter(predicate)),
    },
    select: {
      value: (...fields: readonly Extract<keyof Row<TSchema>, string>[]) =>
        wrap(schema, collection, builder.select(...fields)),
    },
    orderBy: {
      value: (key: Extract<keyof Row<TSchema>, string>, direction: "asc" | "desc" = "asc") =>
        wrap(schema, collection, builder.orderBy(key, direction)),
    },
    limit: {
      value: (count: number) => wrap(schema, collection, builder.take(count)),
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
    registerArtifact(callable, {
      kind: "query-plan",
      schema: collection,
      program,
      mode: "array",
      standard: callable["~query"],
    });
  return callable;
}

function normalizeCqrsProgram(program: QueryProgram): QueryProgram {
  const source = program.nodes as readonly QueryPipelineNode[];
  const filters = source.filter((node) => node.kind === "filter");
  let select: Extract<QueryPipelineNode, { readonly kind: "select:fields" }> | undefined;
  let orderBy: Extract<QueryPipelineNode, { readonly kind: "orderBy" }> | undefined;
  let take: Extract<QueryPipelineNode, { readonly kind: "take" }> | undefined;

  for (const node of source) {
    if (node.kind === "select:fields") select = node;
    else if (node.kind === "orderBy") orderBy = node;
    else if (node.kind === "take" && (take === undefined || node.count < take.count)) take = node;
  }

  return {
    nodes: [
      ...filters,
      ...(orderBy ? [orderBy] : []),
      ...(select ? [select] : []),
      ...(take ? [take] : []),
    ] as readonly QueryNode[],
    bindings: program.bindings,
    ...(program.params === undefined ? {} : { params: program.params }),
  };
}

function hasIncrementalQueryNodes(program: QueryProgram): boolean {
  return program.nodes.some((node) =>
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

function toStandardQuery(
  schema: ATS.AnyTypeSchema,
  program: import("../compiler/query.js").QueryProgram | undefined
): StandardQueryDefinition {
  const nodes = (program?.nodes ?? []) as readonly (QueryNode | { readonly kind: "take"; readonly count: number })[];
  let filter: StandardQueryCondition | undefined;
  let projection: readonly string[] | undefined;
  let order: readonly { readonly path: readonly string[]; readonly direction: "asc" | "desc" }[] | undefined;
  let limit: number | undefined;
  for (const node of nodes) {
    if (node.kind === "filter") {
      const condition = toStandardCondition(node.condition, program?.bindings ?? []);
      filter = filter
        ? Object.freeze({ kind: "logical" as const, operator: "and" as const, left: filter, right: condition })
        : condition;
    } else if (node.kind === "select:fields") projection = Object.freeze([...node.fields]);
    else if (node.kind === "orderBy") {
      const previous = order ?? [];
      order = Object.freeze([
        ...previous,
        Object.freeze({ path: Object.freeze([node.key]), direction: node.direction }),
      ]);
    } else if (node.kind === "take") limit = limit === undefined ? node.count : Math.min(limit, node.count);
  }
  return Object.freeze({
    source: Object.freeze({ kind: "object" as const, fields: Object.freeze(objectFields(schema)) }),
    ...(filter ? { filter } : {}),
    ...(projection ? { projection } : {}),
    ...(order ? { order } : {}),
    ...(limit === undefined ? {} : { limit }),
    params: Object.freeze([...(program?.params ?? [])]),
  });
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
  return Object.freeze({ kind: "not" as const, inner: toStandardCondition(condition.inner, bindings) });
}

function toStandardValue(value: QueryValueNode, bindings: readonly unknown[]): StandardQueryValue {
  if (value.kind === "field") return Object.freeze({ kind: "field" as const, path: Object.freeze([value.key]) });
  if (value.kind === "literal") return Object.freeze({ kind: "literal" as const, value: value.value });
  if (value.kind === "binding") {
    const index = Number.parseInt(value.name.slice(3), 10);
    if (Number.isSafeInteger(index) && index >= 0 && index < bindings.length) {
      return Object.freeze({ kind: "literal" as const, value: bindings[index] });
    }
    return Object.freeze({ kind: "binding" as const, name: value.name });
  }
  return Object.freeze({ kind: "param" as const, name: value.name });
}

export function cqrsInput<TSchema extends ATS.AnyTypeSchema>(
  schema: SchemaInput<TSchema>,
  options: CqrsInputOptions<TSchema>
): CqrsInput<TSchema> {
  const unwrapped = unwrapSchema(schema);
  if (unwrapped.type !== "object" && unwrapped.type !== "runtimeType") {
    throw new JITError("INVALID_QUERY", "JIT.cqrs.input() requires an object or Runtime Type schema");
  }
  if (
    options.filter !== undefined &&
    (options.filter === null || typeof options.filter !== "object" || Array.isArray(options.filter))
  ) {
    throw new JITError("INVALID_QUERY", "CQRS filter configuration must be an object");
  }
  if (options.sort !== undefined && !Array.isArray(options.sort)) {
    throw new JITError("INVALID_QUERY", "CQRS sort configuration must be an array");
  }
  if (options.select !== undefined && typeof options.select !== "boolean") {
    throw new JITError("INVALID_QUERY", "CQRS select configuration must be boolean");
  }
  const maxFilters = options.maxFilters ?? 32;
  const fields = new Set(objectFields(unwrapped));
  for (const [field, operators] of Object.entries(options.filter ?? {})) {
    if (!isSchemaPath(unwrapped, field))
      throw new JITError("INVALID_QUERY", `CQRS filter field ${JSON.stringify(field)} is not declared by the model`);
    if (operators !== true && !Array.isArray(operators)) {
      throw new JITError("INVALID_QUERY", `CQRS filter field ${JSON.stringify(field)} has an invalid operator list`);
    }
    if (operators !== true) {
      if (operators.length === 0) {
        throw new JITError("INVALID_QUERY", `CQRS filter field ${JSON.stringify(field)} has an empty operator list`);
      }
      const seen = new Set<string>();
      for (const operator of operators) {
        if (typeof operator !== "string" || operator.length === 0 || operator.startsWith("$")) {
          throw new JITError("INVALID_QUERY", `CQRS filter field ${JSON.stringify(field)} has an invalid operator`);
        }
        if (seen.has(operator)) {
          throw new JITError(
            "INVALID_QUERY",
            `CQRS filter field ${JSON.stringify(field)} repeats operator ${JSON.stringify(operator)}`
          );
        }
        seen.add(operator);
      }
    }
  }
  const seenSort = new Set<string>();
  for (const field of options.sort ?? []) {
    if (!fields.has(field))
      throw new JITError("INVALID_QUERY", `CQRS sort field ${JSON.stringify(field)} is not declared by the model`);
    if (seenSort.has(field))
      throw new JITError("INVALID_QUERY", `CQRS sort configuration repeats ${JSON.stringify(field)}`);
    seenSort.add(field);
  }
  if (!Number.isSafeInteger(maxFilters) || maxFilters < 0) {
    throw new JITError("INVALID_QUERY", "CQRS maxFilters must be a non-negative safe integer");
  }
  for (const value of [options.limits?.maxConditions, options.limits?.maxSortFields, options.limits?.maxSelectFields]) {
    if (value !== undefined && (!Number.isSafeInteger(value) || value < 0)) {
      throw new JITError("INVALID_QUERY", "CQRS structural limits must be non-negative safe integers");
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
      throw new JITError("INVALID_QUERY", "CQRS pagination requires positive bounded limits");
    }
    if (options.pagination.type === "cursor" && options.pagination.by.length === 0) {
      throw new JITError("INVALID_QUERY", "CQRS cursor pagination requires at least one stable ordering field");
    }
    if (options.pagination.type === "cursor") {
      const seen = new Set<string>();
      for (const field of options.pagination.by) {
        if (!fields.has(field))
          throw new JITError(
            "INVALID_QUERY",
            `CQRS cursor field ${JSON.stringify(field)} is not declared by the model`
          );
        if (seen.has(field))
          throw new JITError("INVALID_QUERY", `CQRS cursor ordering repeats ${JSON.stringify(field)}`);
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
          ? { ...options.pagination, by: Object.freeze([...options.pagination.by]) }
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
    source: Object.freeze({ kind: "object" as const, fields: Object.freeze(objectFields(unwrapped)) }),
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
  return globalThis.Function("__reference", "__decodeCursor", source)(reference, decodeCqrsCursor) as (
    input: unknown
  ) => ParsedCqrsInput;
}

function cqrsParseReference<TSchema extends ATS.AnyTypeSchema>(definition: CqrsInput<TSchema>) {
  return (input: unknown): ParsedCqrsInput => {
    if (input === null || typeof input !== "object" || Array.isArray(input)) {
      throw new JITError("INVALID_QUERY", "CQRS input must be an object");
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
        throw new JITError("INVALID_QUERY", `CQRS input field ${JSON.stringify(key)} is not allowed`);
      }
    }
    const filter = source.filter;
    if (filter === undefined) return normalizeCqrsTail(source, definition, []);
    if (filter === null || typeof filter !== "object" || Array.isArray(filter)) {
      throw new JITError("INVALID_QUERY", "CQRS filter must be an object");
    }
    const allowed: Readonly<Record<string, true | readonly string[] | undefined>> = definition.options.filter ?? {};
    const entries = Object.entries(filter as Record<string, unknown>);
    if (entries.length > (definition.options.maxFilters ?? 32)) {
      throw new JITError("INVALID_QUERY", "CQRS filter exceeds the configured structural limit");
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
      throw new JITError("INVALID_QUERY", "CQRS filter exceeds the configured condition limit");
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
    throw new JITError("INVALID_QUERY", "CQRS sort must be a non-empty string");
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
    if (field.length === 0) throw new JITError("INVALID_QUERY", "CQRS sort field cannot be empty");
    if (sortFields.has(field)) throw new JITError("INVALID_QUERY", `CQRS sort repeats ${JSON.stringify(field)}`);
    sortFields.add(field);
  }
  if (sort.length > (definition.options.limits?.maxSortFields ?? 3)) {
    throw new JITError("INVALID_QUERY", "CQRS sort exceeds the configured structural limit");
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
      sort: pagination.by.map((field) => ({ path: [field], direction: "asc" as const })),
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
    throw new JITError("INVALID_QUERY", "CQRS sparse fields are not allowed");
  }
  if (source.fields.length === 0) throw new JITError("INVALID_QUERY", "CQRS select field cannot be empty");
  const fields = source.fields.split(",");
  if (fields.length > (definition.options.limits?.maxSelectFields ?? 30)) {
    throw new JITError("INVALID_QUERY", "CQRS select exceeds the configured structural limit");
  }
  const allowed = new Set(objectFields(definition.schema));
  const selected = new Set<string>();
  for (const field of fields) {
    if (field.length === 0) throw new JITError("INVALID_QUERY", "CQRS select field cannot be empty");
    if (!allowed.has(field))
      throw new JITError("INVALID_QUERY", `Select field ${JSON.stringify(field)} is not allowed`);
    if (selected.has(field)) throw new JITError("INVALID_QUERY", `CQRS select repeats ${JSON.stringify(field)}`);
    selected.add(field);
  }
  return fields;
}

function sameCursorOrdering(
  sort: readonly { readonly path: readonly string[]; readonly direction: "asc" | "desc" }[],
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
    .join('throw new Error("Invalid CQRS input");')
    .split("__decodeCursor")
    .join("decodeCursor");
  return `function decodeCursor(value, size) { if (typeof value !== "string") throw new Error("Malformed cursor"); try { const bytes = atob(value); let escaped = ""; for (let i = 0; i < bytes.length; i++) escaped += "%" + bytes.charCodeAt(i).toString(16).padStart(2, "0"); const decoded = JSON.parse(decodeURIComponent(escaped)); if (!Array.isArray(decoded) || decoded.length !== size) throw new Error("Malformed cursor"); return decoded; } catch { throw new Error("Malformed cursor"); } } ${parser}`;
}

export const cqrs = Object.freeze({
  input: cqrsInput,
  parse: cqrsParse,
  query: cqrsQuery,
});
