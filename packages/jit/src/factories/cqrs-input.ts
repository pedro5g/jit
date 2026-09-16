import {
  type QueryBoundary,
  type QueryBoundaryPagination,
  queryBoundaryFilters,
  resolveQueryBoundary,
} from "../compiler/query-boundary.js";
import { explainQueryBoundary } from "../compiler/query-cost.js";
import type { QueryCompareOperator } from "../core/ast/index.js";
import type * as ATS from "../core/ats/index.js";
import type { SchemaInput } from "../core/builder/index.js";
import { unwrapSchema } from "../core/builder/index.js";
import { JITError } from "../errors/index.js";
import { registerArtifact } from "../runtime/artifact-registry.js";
import type { CqrsInput, CqrsInputOptions, StandardQueryInput } from "./cqrs.js";
import { objectFields, queryOperatorsForSchema, schemaAtPath } from "./cqrs-standard.js";

const DEFAULT_MAX_OFFSET = 10_000;

interface CqrsInputBuild<TSchema extends ATS.AnyTypeSchema> {
  readonly input: CqrsInput<TSchema>;
  readonly boundary: QueryBoundary;
}

/** Builds and validates the public query boundary before it is registered. */
export function createCqrsInput<TSchema extends ATS.AnyTypeSchema>(
  schema: SchemaInput<TSchema>,
  options: CqrsInputOptions<TSchema>,
  emitSource: (boundary: QueryBoundary) => string
): CqrsInputBuild<TSchema> {
  const unwrapped = unwrapSchema(schema);
  assertInputShape(unwrapped, options);
  const fields = new Set(objectFields(unwrapped));
  const maxFilters = options.maxFilters ?? 32;
  validateFieldConfiguration(unwrapped, options, fields);
  const maxDepth = validateLimits(options, maxFilters);
  validateCursorFields(options, fields);
  const frozenOptions = freezeOptions(options);
  const boundary = resolveBoundary(unwrapped, frozenOptions, maxFilters, maxDepth);
  const definition = createDefinition(boundary);
  const input = {
    schema: unwrapped,
    options: frozenOptions,
    "~query": Object.freeze({ version: 1 as const, definition }),
  } as CqrsInput<TSchema>;
  const explanation = explainQueryBoundary(boundary);

  Object.defineProperty(input, "explain", { enumerable: false, value: () => explanation });
  Object.freeze(input);
  registerArtifact(input, {
    kind: "cqrs-input",
    definition,
    source: emitSource(boundary),
    explanation,
  });
  return { input, boundary };
}

function assertInputShape<TSchema extends ATS.AnyTypeSchema>(
  schema: ATS.AnyTypeSchema,
  options: CqrsInputOptions<TSchema>
): void {
  if (schema.type !== "object" && schema.type !== "runtimeType") {
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
  if (options.select !== undefined && !Array.isArray(options.select)) {
    throw new JITError("INVALID_QUERY", "API query select configuration must be an array");
  }
}

function validateFieldConfiguration<TSchema extends ATS.AnyTypeSchema>(
  schema: ATS.AnyTypeSchema,
  options: CqrsInputOptions<TSchema>,
  fields: ReadonlySet<string>
): void {
  for (const [field, operators] of Object.entries(options.filter ?? {})) {
    const fieldSchema = schemaAtPath(schema, field);
    if (!fieldSchema) {
      throw new JITError(
        "INVALID_QUERY",
        `API query filter field ${JSON.stringify(field)} is not declared by the model`
      );
    }
    const supportedOperators = queryOperatorsForSchema(fieldSchema);
    if (supportedOperators.length === 0) {
      throw new JITError(
        "INVALID_QUERY",
        `API query filter field ${JSON.stringify(field)} is not a scalar query field`
      );
    }
    validateFilterOperators(field, operators, supportedOperators);
  }
  validateUniqueFields(options.sort ?? [], fields, "sort");
  validateUniqueFields(options.select ?? [], fields, "select");
}

function validateFilterOperators(field: string, operators: unknown, supported: readonly QueryCompareOperator[]): void {
  if (operators === true) return;
  if (!Array.isArray(operators)) {
    throw new JITError("INVALID_QUERY", `API query filter field ${JSON.stringify(field)} has an invalid operator list`);
  }
  if (operators.length === 0) {
    throw new JITError("INVALID_QUERY", `API query filter field ${JSON.stringify(field)} has an empty operator list`);
  }
  const seen = new Set<string>();
  for (const operator of operators) {
    if (typeof operator !== "string" || !supported.includes(operator as QueryCompareOperator)) {
      throw new JITError("INVALID_QUERY", `API query filter field ${JSON.stringify(field)} has an invalid operator`);
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

function validateUniqueFields(fields: readonly string[], declared: ReadonlySet<string>, kind: string): void {
  const seen = new Set<string>();
  for (const field of fields) {
    if (!declared.has(field)) {
      throw new JITError(
        "INVALID_QUERY",
        `API query ${kind} field ${JSON.stringify(field)} is not declared by the model`
      );
    }
    if (seen.has(field))
      throw new JITError("INVALID_QUERY", `API query ${kind} configuration repeats ${JSON.stringify(field)}`);
    seen.add(field);
  }
}

function validateLimits<TSchema extends ATS.AnyTypeSchema>(
  options: CqrsInputOptions<TSchema>,
  maxFilters: number
): number {
  if (!Number.isSafeInteger(maxFilters) || maxFilters < 0) {
    throw new JITError("INVALID_QUERY", "API query maxFilters must be a non-negative safe integer");
  }
  for (const value of [options.limits?.maxConditions, options.limits?.maxSortFields, options.limits?.maxSelectFields]) {
    if (value !== undefined && (!Number.isSafeInteger(value) || value < 0)) {
      throw new JITError("INVALID_QUERY", "API query structural limits must be non-negative safe integers");
    }
  }
  const maxDepth = options.limits?.maxDepth ?? 3;
  if (!Number.isSafeInteger(maxDepth) || maxDepth < 1) {
    throw new JITError("INVALID_QUERY", "API query maxDepth must be a positive safe integer");
  }
  if (!options.pagination) return maxDepth;
  const { defaultLimit, maxLimit } = options.pagination;
  if (
    !Number.isSafeInteger(defaultLimit) ||
    !Number.isSafeInteger(maxLimit) ||
    defaultLimit < 1 ||
    maxLimit < defaultLimit
  ) {
    throw new JITError("INVALID_QUERY", "API query pagination requires positive bounded limits");
  }
  if (options.pagination.type === "offset") {
    const maxOffset = options.pagination.maxOffset ?? DEFAULT_MAX_OFFSET;
    if (!Number.isSafeInteger(maxOffset) || maxOffset < 0) {
      throw new JITError("INVALID_QUERY", "API query maxOffset must be a non-negative safe integer");
    }
  }
  if (options.pagination.type === "cursor" && options.pagination.by.length === 0) {
    throw new JITError("INVALID_QUERY", "API query cursor pagination requires at least one stable ordering field");
  }
  return maxDepth;
}

function validateCursorFields<TSchema extends ATS.AnyTypeSchema>(
  options: CqrsInputOptions<TSchema>,
  fields: ReadonlySet<string>
): void {
  if (options.pagination?.type !== "cursor") return;
  validateUniqueFields(options.pagination.by, fields, "cursor");
}

function freezeOptions<TSchema extends ATS.AnyTypeSchema>(
  options: CqrsInputOptions<TSchema>
): CqrsInputOptions<TSchema> {
  const frozenFilter = Object.freeze(
    Object.fromEntries(
      Object.entries(options.filter ?? {}).map(([field, allowed]) => [
        field,
        allowed === true ? true : Object.freeze([...(allowed as readonly string[])]),
      ])
    )
  ) as CqrsInputOptions<TSchema>["filter"];
  const frozenSort = Object.freeze([...(options.sort ?? [])]) as CqrsInputOptions<TSchema>["sort"];
  const frozenSelect =
    options.select === undefined
      ? undefined
      : (Object.freeze([...options.select]) as CqrsInputOptions<TSchema>["select"]);
  const frozenPagination = options.pagination
    ? Object.freeze(
        options.pagination.type === "cursor"
          ? { ...options.pagination, by: Object.freeze([...options.pagination.by]) }
          : { ...options.pagination, maxOffset: options.pagination.maxOffset ?? DEFAULT_MAX_OFFSET }
      )
    : undefined;
  const frozenLimits = options.limits ? Object.freeze({ ...options.limits }) : undefined;
  return Object.freeze({
    ...options,
    ...(frozenFilter === undefined ? {} : { filter: frozenFilter }),
    ...(frozenSort === undefined ? {} : { sort: frozenSort }),
    ...(frozenSelect === undefined ? {} : { select: frozenSelect }),
    ...(frozenPagination === undefined ? {} : { pagination: frozenPagination }),
    ...(frozenLimits === undefined ? {} : { limits: frozenLimits }),
  }) as CqrsInputOptions<TSchema>;
}

function resolveBoundary<TSchema extends ATS.AnyTypeSchema>(
  schema: ATS.AnyTypeSchema,
  options: CqrsInputOptions<TSchema>,
  maxFilters: number,
  maxDepth: number
): QueryBoundary {
  const pagination: QueryBoundaryPagination | undefined = options.pagination
    ? options.pagination.type === "cursor"
      ? {
          type: "cursor",
          by: options.pagination.by,
          defaultLimit: options.pagination.defaultLimit,
          maxLimit: options.pagination.maxLimit,
        }
      : {
          type: "offset",
          defaultLimit: options.pagination.defaultLimit,
          maxLimit: options.pagination.maxLimit,
          maxOffset: options.pagination.maxOffset ?? DEFAULT_MAX_OFFSET,
        }
    : undefined;
  return resolveQueryBoundary({
    sourceFields: objectFields(schema),
    filters: Object.entries(options.filter ?? {}).map(([path, operators]) => ({
      path,
      operators: operators as true | readonly string[],
    })),
    projection: options.select ?? [],
    sorting: options.sort ?? [],
    ...(pagination === undefined ? {} : { pagination }),
    limits: {
      maxFilters,
      maxConditions: options.limits?.maxConditions ?? maxFilters,
      maxSortFields: options.limits?.maxSortFields ?? 3,
      maxSelectFields: options.limits?.maxSelectFields ?? 30,
      maxDepth,
      ...(options.limits?.maxCost === undefined ? {} : { maxCost: options.limits.maxCost }),
    },
  });
}

function createDefinition(boundary: QueryBoundary): StandardQueryInput["definition"] {
  return Object.freeze({
    source: Object.freeze({ kind: "object" as const, fields: boundary.sourceFields }),
    filters: Object.freeze(Object.fromEntries(queryBoundaryFilters(boundary))),
    projection: boundary.projection.length > 0,
    sorting: boundary.sorting,
    ...(boundary.pagination
      ? {
          pagination: Object.freeze(
            boundary.pagination.type === "cursor"
              ? {
                  type: "cursor" as const,
                  by: boundary.pagination.by,
                  defaultLimit: boundary.pagination.defaultLimit,
                  maxLimit: boundary.pagination.maxLimit,
                }
              : {
                  type: "offset" as const,
                  defaultLimit: boundary.pagination.defaultLimit,
                  maxLimit: boundary.pagination.maxLimit,
                }
          ),
        }
      : {}),
    limits: Object.freeze({
      maxConditions: boundary.limits.maxConditions,
      maxSortFields: boundary.limits.maxSortFields,
      maxSelectFields: boundary.limits.maxSelectFields,
    }),
  });
}
