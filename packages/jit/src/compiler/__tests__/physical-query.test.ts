import { Compiler, JIT } from "../../index.js";
import { getArtifact } from "../../runtime/artifact-registry.js";

describe("physical query planning", () => {
  const User = JIT.object({
    id: JIT.number(),
    email: JIT.string(),
    at: JIT.date(),
  });
  type User = JIT.Typeof<typeof User>;

  const rows: User[] = Array.from({ length: 200 }, (_, index) => ({
    id: index,
    email: `user-${index}@example.com`,
    at: new Date(1_000 + index * 1_000),
  }));

  function planOf(compiled: object) {
    const artifact = getArtifact(compiled);

    if (artifact?.kind !== "query-plan") throw new Error("query plan artifact not registered");
    return {
      physical: Compiler.explainPhysicalQuery(artifact.schema, artifact.program as never),
      source: Compiler.emitQuerySource(artifact.schema, artifact.program as never),
    };
  }

  it("looks a keyed collection up through the shared index cache", () => {
    const Users = JIT.array(User).keyed("id");
    const byId = JIT.cqrs
      .query(Users)
      .params({ id: JIT.number() })
      .where((query, params) => query.eq("id", params.id))
      .first();
    const { physical, source } = planOf(byId);

    expect(physical).toEqual({
      strategy: "CachedIndexLookup",
      reason: "the collection is keyed, so the index is built once per array and reused",
      complexity: "O(1)",
      facts: ["keyed: id", "index cache: enabled"],
    });
    expect(byId(rows, { id: 137 })).toBe(rows[137]);
    expect(byId(rows, { id: 9_999 })).toBeUndefined();
    // No loop over the rows survives: the answer comes from the map.
    expect(source).toContain("__cachedIndex(value,");
    expect(source).toContain(".get(params.id)");
    expect(source).not.toContain("for (let i = 0; i < len; i++) {\n    const item");
  });

  it("binary-searches a collection declared ordered and unique", () => {
    const Users = JIT.array(User).ordered("id", "asc").uniqueBy("id");
    const byId = JIT.cqrs
      .query(Users)
      .params({ id: JIT.number() })
      .where((query, params) => query.eq("id", params.id))
      .first();
    const { physical, source } = planOf(byId);

    expect(physical.strategy).toBe("BinarySearch");
    expect(physical.complexity).toBe("O(log n)");
    expect(physical.facts).toEqual(["ordered: id asc", "unique key: id"]);
    expect(byId(rows, { id: 137 })).toBe(rows[137]);
    expect(byId(rows, { id: 0 })).toBe(rows[0]);
    expect(byId(rows, { id: 199 })).toBe(rows[199]);
    expect(byId(rows, { id: 9_999 })).toBeUndefined();
    expect(source).toContain("(low + high) >>> 1");
    // Nothing is allocated to search: no map, no array.
    expect(source).not.toContain("new Map()");
  });

  it("searches a descending collection from the other side", () => {
    const Users = JIT.array(User).ordered("id", "desc").uniqueBy("id");
    const byId = JIT.cqrs
      .query(Users)
      .params({ id: JIT.number() })
      .where((query, params) => query.eq("id", params.id))
      .first();
    const descending = [...rows].reverse();
    const { source } = planOf(byId);

    expect(source).toContain("if (probe > target) low = mid + 1;");
    expect(byId(descending, { id: 137 })).toBe(rows[137]);
    expect(byId(descending, { id: 9_999 })).toBeUndefined();
  });

  it("answers some through the same access path", () => {
    const Users = JIT.array(User).keyed("id");
    const exists = JIT.cqrs
      .query(Users)
      .params({ id: JIT.number() })
      .where((query, params) => query.eq("id", params.id))
      .some();
    const { physical, source } = planOf(exists);

    expect(physical.strategy).toBe("CachedIndexLookup");
    expect(exists(rows, { id: 12 })).toBe(true);
    expect(exists(rows, { id: 9_999 })).toBe(false);
    expect(source).toContain("return row !== undefined;");
  });

  it("matches a Date key on its timestamp through the index", () => {
    const Users = JIT.array(User).keyed("at");
    const byAt = JIT.cqrs
      .query(Users)
      .params({ at: JIT.date() })
      .where((query, params) => query.eq("at", params.at))
      .first();
    const { physical } = planOf(byAt);

    expect(physical.strategy).toBe("CachedIndexLookup");
    expect(byAt(rows, { at: new Date(1_000 + 5 * 1_000) })).toBe(rows[5]);
    expect(byAt(rows, { at: new Date(7) })).toBeUndefined();
  });

  it("falls back to a scan when no fact supports a keyed access path", () => {
    const Users = JIT.array(User);
    const scanFirst = JIT.cqrs
      .query(Users)
      .where((query) => query.eq("id", 5))
      .first();
    // A key with no matching fact, a non-equality operator, and two filters
    // are each enough to keep the query on a scan.
    const wrongKey = JIT.cqrs
      .query(JIT.array(User).keyed("id"))
      .where((query) => query.eq("email", "a@b.c"))
      .first();
    const notEquality = JIT.cqrs
      .query(JIT.array(User).keyed("id"))
      .where((query) => query.gt("id", 5))
      .first();
    const twoFilters = JIT.cqrs
      .query(JIT.array(User).keyed("id"))
      .where((query) => query.eq("id", 5))
      .where((query) => query.eq("email", "a@b.c"))
      .first();

    for (const query of [scanFirst, wrongKey, notEquality, twoFilters]) {
      expect(planOf(query).physical.strategy).toBe("EarlyExitScan");
    }
    expect(scanFirst(rows)).toBe(rows[5]);
    expect(twoFilters(rows)).toBeUndefined();
  });

  it("keeps findIndex and every on a scan, since neither can be answered by key", () => {
    const Users = JIT.array(User).keyed("id");
    const index = JIT.cqrs
      .query(Users)
      .where((query) => query.eq("id", 5))
      .findIndex();
    const all = JIT.cqrs
      .query(Users)
      .where((query) => query.eq("id", 5))
      .every();

    expect(planOf(index).physical.strategy).toBe("EarlyExitScan");
    expect(planOf(all).physical.strategy).toBe("EarlyExitScan");
    expect(index(rows)).toBe(5);
    expect(all(rows)).toBe(false);
  });

  it("does not index a collection that only declares indexBy, where the build never repays", () => {
    // `.indexBy` states equality intent without opting into a cached index, and
    // building one for a single lookup is measurably worse than scanning.
    const Users = JIT.array(User).indexBy("id");
    const byId = JIT.cqrs
      .query(Users)
      .where((query) => query.eq("id", 5))
      .first();

    expect(planOf(byId).physical.strategy).toBe("EarlyExitScan");
  });

  it("reports the decision through explain, without exposing query nodes", () => {
    const Users = JIT.array(User).keyed("id");
    const byId = JIT.cqrs
      .query(Users)
      .where((query) => query.eq("id", 5))
      .first();
    const plan = byId.explain();

    expect(plan.physical).toEqual({
      strategy: "CachedIndexLookup",
      reason: "the collection is keyed, so the index is built once per array and reused",
      complexity: "O(1)",
      facts: ["keyed: id", "index cache: enabled"],
    });
    // The incremental backends stream and never reach a row by key.
    expect(byId.explain("generator").physical).toBeUndefined();
  });

  it("keeps the physical strategy out of the portable ~query contract", () => {
    const Users = JIT.array(User).keyed("id");
    const byId = JIT.cqrs
      .query(Users)
      .where((query) => query.eq("id", 5))
      .first();
    const standard = JSON.stringify(byId["~query"]);

    expect(standard).not.toContain("CachedIndexLookup");
    expect(standard).not.toContain("strategy");
    expect(standard).toContain('"terminal"');
  });

  it("agrees with a scan over the same data", () => {
    const keyed = JIT.cqrs
      .query(JIT.array(User).keyed("id"))
      .params({ id: JIT.number() })
      .where((query, params) => query.eq("id", params.id))
      .first();
    const ordered = JIT.cqrs
      .query(JIT.array(User).ordered("id", "asc").uniqueBy("id"))
      .params({ id: JIT.number() })
      .where((query, params) => query.eq("id", params.id))
      .first();
    const scan = JIT.cqrs
      .query(JIT.array(User))
      .params({ id: JIT.number() })
      .where((query, params) => query.eq("id", params.id))
      .first();

    for (const id of [-1, 0, 1, 99, 199, 200, 1_000]) {
      const expected = scan(rows, { id });

      expect(keyed(rows, { id })).toBe(expected);
      expect(ordered(rows, { id })).toBe(expected);
    }
  });
});
