import { JITError } from "../errors/index.js";

/** One filter capability resolved before an untrusted request is parsed. */
export interface QueryBoundaryField {
  readonly path: readonly string[];
  readonly operators: readonly string[];
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
  readonly limits: QueryBoundaryLimits;
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

  return Object.freeze({
    sourceFields: Object.freeze([...input.sourceFields]),
    fields: Object.freeze(fields),
    relations: Object.freeze([]),
    collections: Object.freeze([]),
    logical: Object.freeze({ and: false, or: false, not: false }),
    projection: Object.freeze([...input.projection]),
    sorting: Object.freeze([...input.sorting]),
    pagination,
    limits: Object.freeze({ ...input.limits }),
  });
}

/** Legacy parser shape derived from the semantic descriptor at compile time. */
export function queryBoundaryFilters(
  boundary: QueryBoundary
): readonly [path: string, operators: true | readonly string[]][] {
  return boundary.fields.map((field) => {
    const path = field.path.join(".");
    return field.operators.length === 1 && field.operators[0] === "eq" ? [path, true] : [path, field.operators];
  });
}
