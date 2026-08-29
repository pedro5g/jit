import type { QueryBoundary } from "./query-boundary.js";

/**
 * Conservative semantic weights for one public query.
 *
 * This is complexity, not a datastore estimate: it says how much work a
 * request is asking an adapter to consider, so an amplifying request can be
 * refused before anything reaches storage. A backend may later add its own
 * physical cost on top; it must not be folded into these numbers.
 */
export const QUERY_COST_WEIGHTS = Object.freeze({
  equality: 1,
  range: 2,
  sort: 3,
  relation: 5,
  collection: 8,
});

export type QueryCostWeights = typeof QUERY_COST_WEIGHTS;

/** Semantic weight of one normalized condition operator. */
export function queryOperatorCost(operator: string): number {
  return operator === "eq" || operator === "neq" ? QUERY_COST_WEIGHTS.equality : QUERY_COST_WEIGHTS.range;
}

/** Weight of the most expensive condition a declared field can produce. */
export function queryFieldCost(operators: readonly string[]): number {
  let cost = 0;
  for (let index = 0; index < operators.length; index++) {
    const operator = operators[index] as string;
    const operatorCost = queryOperatorCost(operator);
    if (operatorCost > cost) cost = operatorCost;
  }
  return cost;
}

/**
 * Every condition the declared fields can produce, most expensive first.
 *
 * A field declared with an operator list accepts both the `$gte` and `gte`
 * spellings, so one request key can yield two conditions per operator. The
 * equality shorthand accepts a direct value only, and yields one.
 */
export function queryBoundaryConditionCosts(
  fields: readonly { readonly operators: readonly string[] }[]
): readonly number[] {
  const costs: number[] = [];
  for (const field of fields) {
    if (field.operators.length === 1 && field.operators[0] === "eq") {
      costs.push(QUERY_COST_WEIGHTS.equality);
      continue;
    }
    for (const operator of field.operators) {
      const cost = queryOperatorCost(operator);
      costs.push(cost, cost);
    }
  }
  return costs.sort((left, right) => right - left);
}

/**
 * Largest cost the structural limits already permit.
 *
 * It is the default budget: the semantic budget narrows a boundary, it never
 * widens one, so an unconfigured `maxCost` cannot reject a request the
 * declared limits accept.
 */
export function queryBoundaryMaxCost(input: {
  readonly fields: readonly { readonly operators: readonly string[] }[];
  readonly relations: readonly unknown[];
  readonly collections: readonly unknown[];
  readonly sorting: readonly string[];
  readonly pagination: QueryBoundary["pagination"];
  readonly limits: { readonly maxConditions: number; readonly maxSortFields: number };
}): number {
  const costs = queryBoundaryConditionCosts(input.fields);
  let total = 0;
  const affordable = Math.min(costs.length, input.limits.maxConditions);
  for (let index = 0; index < affordable; index++) total += costs[index] as number;
  // Cursor pagination fixes ordering to its own tuple, so that is the widest
  // ordering a request can ask for on such a boundary.
  const orderable = input.pagination?.type === "cursor" ? input.pagination.by.length : input.sorting.length;
  return total + QUERY_COST_WEIGHTS.sort * Math.min(orderable, input.limits.maxSortFields);
}

/** What a boundary permits, reported without compiling or running a request. */
export interface QueryBoundaryExplanation {
  readonly fields: readonly {
    readonly path: string;
    readonly operators: readonly string[];
    readonly cost: number;
  }[];
  readonly projection: readonly string[];
  readonly sorting: readonly string[];
  readonly pagination: QueryBoundary["pagination"];
  readonly limits: QueryBoundary["limits"];
  readonly cost: {
    readonly weights: QueryCostWeights;
    readonly sort: number;
    /** Highest total the structural limits allow, before `maxCost` is applied. */
    readonly structural: number;
    /** Budget actually enforced while a request is normalized. */
    readonly budget: number;
  };
}

export function explainQueryBoundary(boundary: QueryBoundary): QueryBoundaryExplanation {
  return Object.freeze({
    fields: Object.freeze(
      boundary.fields.map((field) =>
        Object.freeze({
          path: field.path.join("."),
          operators: field.operators,
          cost: queryFieldCost(field.operators),
        })
      )
    ),
    projection: boundary.projection,
    sorting: boundary.sorting,
    pagination: boundary.pagination,
    limits: boundary.limits,
    cost: Object.freeze({
      weights: QUERY_COST_WEIGHTS,
      sort: QUERY_COST_WEIGHTS.sort,
      structural: queryBoundaryMaxCost(boundary),
      budget: boundary.limits.maxCost,
    }),
  });
}
