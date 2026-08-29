import { describe, expect, it } from "vitest";
import { resolveQueryBoundary } from "../query-boundary.js";
import {
  explainQueryBoundary,
  QUERY_COST_WEIGHTS,
  queryBoundaryConditionCosts,
  queryBoundaryMaxCost,
  queryFieldCost,
  queryOperatorCost,
} from "../query-cost.js";

const boundary = (options: {
  filters?: readonly { path: string; operators: true | readonly string[] }[];
  sorting?: readonly string[];
  maxConditions?: number;
  maxSortFields?: number;
  maxCost?: number;
}) =>
  resolveQueryBoundary({
    sourceFields: ["id", "age", "name"],
    filters: options.filters ?? [],
    projection: [],
    sorting: options.sorting ?? [],
    limits: {
      maxFilters: 8,
      maxConditions: options.maxConditions ?? 8,
      maxSortFields: options.maxSortFields ?? 3,
      maxSelectFields: 8,
      maxDepth: 3,
      ...(options.maxCost === undefined ? {} : { maxCost: options.maxCost }),
    },
  });

describe("QueryCost", () => {
  it("weights equality below ranges and ordering above both", () => {
    expect(queryOperatorCost("eq")).toBe(QUERY_COST_WEIGHTS.equality);
    expect(queryOperatorCost("neq")).toBe(QUERY_COST_WEIGHTS.equality);
    expect(queryOperatorCost("gte")).toBe(QUERY_COST_WEIGHTS.range);
    expect(queryFieldCost(["eq", "gte"])).toBe(QUERY_COST_WEIGHTS.range);
    expect(QUERY_COST_WEIGHTS.sort).toBeGreaterThan(QUERY_COST_WEIGHTS.range);
    expect(QUERY_COST_WEIGHTS.collection).toBeGreaterThan(QUERY_COST_WEIGHTS.relation);
  });

  it("counts both operator spellings and only one shorthand equality", () => {
    expect(queryBoundaryConditionCosts([{ operators: ["eq"] }])).toEqual([1]);
    expect(queryBoundaryConditionCosts([{ operators: ["gte", "eq"] }])).toEqual([2, 2, 1, 1]);
  });

  it("bounds the worst request by the condition and ordering limits", () => {
    const wide = boundary({
      filters: [
        { path: "id", operators: true },
        { path: "age", operators: ["gte", "lte"] },
      ],
      sorting: ["name"],
    });

    // [2, 2, 2, 2, 1] conditions plus one ordering field.
    expect(queryBoundaryMaxCost(wide)).toBe(9 + QUERY_COST_WEIGHTS.sort);
    expect(queryBoundaryMaxCost({ ...wide, limits: { ...wide.limits, maxConditions: 2 } })).toBe(
      4 + QUERY_COST_WEIGHTS.sort
    );
    expect(queryBoundaryMaxCost({ ...wide, limits: { ...wide.limits, maxSortFields: 0 } })).toBe(9);
  });

  it("defaults the budget to what the structural limits already permit", () => {
    const permissive = boundary({ filters: [{ path: "age", operators: ["gte"] }], sorting: ["name"] });

    expect(permissive.limits.maxCost).toBe(queryBoundaryMaxCost(permissive));
    expect(boundary({ maxCost: 4 }).limits.maxCost).toBe(4);
    expect(() => boundary({ maxCost: -1 })).toThrow(/maxCost/i);
    expect(() => boundary({ maxCost: 1.5 })).toThrow(/maxCost/i);
  });

  it("explains a boundary without compiling or running a request", () => {
    const explained = explainQueryBoundary(
      boundary({ filters: [{ path: "age", operators: ["gte", "lte"] }], sorting: ["name"], maxCost: 5 })
    );

    expect(explained.fields).toEqual([{ path: "age", operators: ["gte", "lte"], cost: 2 }]);
    expect(explained.cost.budget).toBe(5);
    expect(explained.cost.structural).toBe(11);
    expect(explained.cost.weights).toBe(QUERY_COST_WEIGHTS);
    expect(Object.isFrozen(explained)).toBe(true);
  });
});
