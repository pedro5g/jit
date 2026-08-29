import { JITError } from "../errors/index.js";
import { queryBoundaryMaxCost } from "./query-cost.js";

/** One filter capability resolved before an untrusted request is parsed. */
export interface QueryBoundaryField {
  readonly path: readonly string[];
  readonly operators: readonly string[];
  /**
   * True when the field was declared with the `true` shorthand.
   *
   * The shorthand accepts a direct value only. Declaring `["eq"]` allows the
   * same operator through an operator object as well, so the two cannot be
   * told apart by the operator list alone.
   */
  readonly shorthand: boolean;
}

export interface QueryBoundaryRelation {
  readonly path: readonly string[];
  readonly boundary: QueryBoundary;
}

export interface QueryBoundaryCollection {
  readonly path: readonly string[];
  readonly operations: readonly ("some" | "every" | "none")[];
  readonly boundary: QueryBoundary;
}

export interface QueryBoundaryLogical {
  readonly and: boolean;
  readonly or: boolean;
  readonly not: boolean;
}

export type QueryBoundaryPagination =
  | {
      readonly type: "offset";
      readonly defaultLimit: number;
      readonly maxLimit: number;
      readonly maxOffset: number;
    }
  | {
      readonly type: "cursor";
      readonly by: readonly string[];
      readonly defaultLimit: number;
      readonly maxLimit: number;
    };

export interface QueryBoundaryLimits {
  readonly maxFilters: number;
  readonly maxConditions: number;
  readonly maxSortFields: number;
  readonly maxSelectFields: number;
  /** Last global stop for traversal depth; declarations remain the primary boundary. */
  readonly maxDepth: number;
  /** Semantic complexity budget; defaults to what the structural limits already allow. */
  readonly maxCost: number;
}

/**
 * Immutable semantic capability consumed while parsing public query input.
 * It is not a query AST node and must not reach query optimization.
 */
export interface QueryBoundary {
  readonly sourceFields: readonly string[];
  readonly fields: readonly QueryBoundaryField[];
  readonly relations: readonly QueryBoundaryRelation[];
  readonly collections: readonly QueryBoundaryCollection[];
  readonly logical: QueryBoundaryLogical;
  readonly projection: readonly string[];
  readonly sorting: readonly string[];
  readonly pagination: QueryBoundaryPagination | null;
  readonly limits: QueryBoundaryLimits;
}

export interface QueryBoundaryInput {
  readonly sourceFields: readonly string[];
  readonly filters: readonly {
    readonly path: string;
    readonly operators: true | readonly string[];
  }[];
  readonly projection: readonly string[];
  readonly sorting: readonly string[];
  readonly pagination?: QueryBoundaryPagination;
  readonly limits: Omit<QueryBoundaryLimits, "maxCost"> & { readonly maxCost?: number };
}

/** Resolves the current flat public-query surface into the extensible IR. */
export function resolveQueryBoundary(input: QueryBoundaryInput): QueryBoundary {
  const fields = input.filters.map(({ path, operators }) => {
    const segments = path.split(".");
    if (segments.length > input.limits.maxDepth) {
      throw new JITError(
        "INVALID_QUERY",
        `API query filter field ${JSON.stringify(path)} exceeds the configured traversal depth`
      );
    }
    return Object.freeze({
      path: Object.freeze(segments),
      operators: Object.freeze(operators === true ? ["eq"] : [...operators]),
      shorthand: operators === true,
    });
  });
  const pagination =
    input.pagination === undefined
      ? null
      : Object.freeze(
          input.pagination.type === "cursor"
            ? { ...input.pagination, by: Object.freeze([...input.pagination.by]) }
            : { ...input.pagination }
        );

  const shape = {
    sourceFields: Object.freeze([...input.sourceFields]),
    fields: Object.freeze(fields),
    relations: Object.freeze([]),
    collections: Object.freeze([]),
    logical: Object.freeze({ and: false, or: false, not: false }),
    projection: Object.freeze([...input.projection]),
    sorting: Object.freeze([...input.sorting]),
    pagination,
  };
  const structural = queryBoundaryMaxCost({ ...shape, limits: input.limits });
  const maxCost = input.limits.maxCost ?? structural;
  if (!Number.isSafeInteger(maxCost) || maxCost < 0) {
    throw new JITError("INVALID_QUERY", "API query maxCost must be a non-negative safe integer");
  }

  return Object.freeze({
    ...shape,
    limits: Object.freeze({ ...input.limits, maxCost }),
  });
}

/** Legacy parser shape derived from the semantic descriptor at compile time. */
export function queryBoundaryFilters(
  boundary: QueryBoundary
): readonly [path: string, operators: true | readonly string[]][] {
  return boundary.fields.map((field) => [field.path.join("."), field.shorthand ? true : field.operators]);
}
