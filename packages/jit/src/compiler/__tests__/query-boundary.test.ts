import { describe, expect, it } from "vitest";
import { queryBoundaryFilters, resolveQueryBoundary } from "../query-boundary.js";

describe("QueryBoundary", () => {
  it("resolves and freezes the current deny-by-default capability", () => {
    const boundary = resolveQueryBoundary({
      sourceFields: ["id", "name", "createdAt"],
      filters: [
        { path: "id", operators: true },
        { path: "createdAt", operators: ["gte", "lte"] },
      ],
      projection: ["id", "name"],
      sorting: ["createdAt"],
      pagination: { type: "cursor", by: ["createdAt", "id"], defaultLimit: 20, maxLimit: 100 },
      limits: { maxFilters: 8, maxConditions: 10, maxSortFields: 2, maxSelectFields: 2 },
    });

    expect(boundary).toEqual({
      sourceFields: ["id", "name", "createdAt"],
      fields: [
        { path: ["id"], operators: ["eq"] },
        { path: ["createdAt"], operators: ["gte", "lte"] },
      ],
      relations: [],
      collections: [],
      logical: { and: false, or: false, not: false },
      projection: ["id", "name"],
      sorting: ["createdAt"],
      pagination: { type: "cursor", by: ["createdAt", "id"], defaultLimit: 20, maxLimit: 100 },
      limits: { maxFilters: 8, maxConditions: 10, maxSortFields: 2, maxSelectFields: 2 },
    });
    expect(Object.isFrozen(boundary)).toBe(true);
    expect(Object.isFrozen(boundary.fields[0])).toBe(true);
    expect(Object.isFrozen(boundary.fields[0]?.path)).toBe(true);
    expect(Object.isFrozen(boundary.pagination)).toBe(true);
    expect(queryBoundaryFilters(boundary)).toEqual([
      ["id", true],
      ["createdAt", ["gte", "lte"]],
    ]);
  });

  it("keeps undeclared traversal and logical capabilities closed", () => {
    const boundary = resolveQueryBoundary({
      sourceFields: ["id"],
      filters: [],
      projection: [],
      sorting: [],
      limits: { maxFilters: 0, maxConditions: 0, maxSortFields: 0, maxSelectFields: 0 },
    });

    expect(boundary.fields).toEqual([]);
    expect(boundary.relations).toEqual([]);
    expect(boundary.collections).toEqual([]);
    expect(boundary.logical).toEqual({ and: false, or: false, not: false });
    expect(boundary.pagination).toBeNull();
  });
});
