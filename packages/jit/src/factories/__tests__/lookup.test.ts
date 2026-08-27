import { Compiler, JIT } from "../../index.js";
import { getArtifact } from "../../runtime/artifact-registry.js";

const User = JIT.object({ id: JIT.number().int(), name: JIT.string() });
const rows = [
  { id: 3, name: "c" },
  { id: 1, name: "a" },
  { id: 2, name: "b" },
];
const sorted = [...rows].sort((left, right) => left.id - right.id);

function sourceOf(plan: object): string {
  const artifact = getArtifact(plan);

  if (artifact?.kind !== "lookup-plan") throw new Error("lookup plan not registered");
  return Compiler.emitLookupSource(artifact.lookup);
}

describe("JIT.lookup", () => {
  /**
   * The whole point of the operation: the caller asks for a row by key and the
   * compiler picks the access path from what the collection declares. Naming
   * an algorithm is never part of the API.
   */
  describe("chooses the access path from the collection's facts", () => {
    it("scans, and exits early, when no fact reaches the key", () => {
      const plan = JIT.lookup(JIT.array(User)).by("id");

      expect(plan.explain().strategy).toBe("EarlyExitScan");
      expect(plan.explain().complexity).toBe("O(k)");
      expect(plan(rows, 2)).toEqual({ id: 2, name: "b" });
      expect(plan(rows, 9)).toBeUndefined();
    });

    it("reuses the shared index when the collection is keyed", () => {
      const plan = JIT.lookup(JIT.array(User).keyed("id"));

      expect(plan.explain().strategy).toBe("CachedIndexLookup");
      expect(plan.explain().complexity).toBe("O(1)");
      expect(plan(rows, 2)).toEqual({ id: 2, name: "b" });
      expect(plan(rows, 9)).toBeUndefined();
    });

    it("searches without allocating when the key is ordered and unique", () => {
      const plan = JIT.lookup(JIT.array(User).ordered("id", "asc").uniqueBy("id"));

      expect(plan.explain().strategy).toBe("BinarySearch");
      expect(plan.explain().complexity).toBe("O(log n)");
      expect(plan(sorted, 1)).toEqual({ id: 1, name: "a" });
      expect(plan(sorted, 3)).toEqual({ id: 3, name: "c" });
      expect(plan(sorted, 9)).toBeUndefined();
    });

    it("follows a descending declaration into the other half", () => {
      const plan = JIT.lookup(JIT.array(User).ordered("id", "desc").uniqueBy("id"));
      const descending = [...sorted].reverse();

      for (const row of descending) expect(plan(descending, row.id)).toEqual(row);
      expect(plan(descending, 9)).toBeUndefined();
    });

    it("infers the key from the fact rather than requiring .by()", () => {
      const plan = JIT.lookup(JIT.array(User).keyed("id"));

      expect(plan(rows, 1)).toEqual({ id: 1, name: "a" });
    });

    it("lets .by() override an inferred key", () => {
      const plan = JIT.lookup(JIT.array(User).keyed("id")).by("name");

      expect(plan(rows, "b")).toEqual({ id: 2, name: "b" });
    });
  });

  /** A Date keys a Map by identity, so both sides have to become timestamps. */
  it("matches a Date key by its timestamp", () => {
    const Event = JIT.object({ at: JIT.date(), tag: JIT.string() });
    const at = new Date("2026-01-02T00:00:00Z");
    const events = [
      { at: new Date("2026-01-01T00:00:00Z"), tag: "x" },
      { at, tag: "y" },
    ];

    for (const schema of [JIT.array(Event).keyed("at"), JIT.array(Event)] as const) {
      const plan = JIT.lookup(schema).by("at");

      expect(plan(events, new Date("2026-01-02T00:00:00Z"))).toEqual({ at, tag: "y" });
      expect(plan(events, new Date("2026-03-01T00:00:00Z"))).toBeUndefined();
    }
  });

  it("answers the same row every path would, over the same data", () => {
    const scan = JIT.lookup(JIT.array(User)).by("id");
    const keyed = JIT.lookup(JIT.array(User).keyed("id"));
    const binary = JIT.lookup(JIT.array(User).ordered("id", "asc").uniqueBy("id"));

    for (const id of [1, 2, 3, 4]) {
      expect(keyed(sorted, id)).toEqual(scan(sorted, id));
      expect(binary(sorted, id)).toEqual(scan(sorted, id));
    }
  });

  it("refuses a collection with no key fact and no named key", () => {
    expect(() => JIT.lookup(JIT.array(User))(rows, 1)).toThrow(/needs a key/);
  });

  it("rejects a key the row does not have", () => {
    // @ts-expect-error — "missing" is not a key of the row
    expect(() => JIT.lookup(JIT.array(User)).by("missing")).toThrow();
  });

  describe("generated source", () => {
    it("allocates nothing on the scan path and returns from inside the loop", () => {
      const source = sourceOf(JIT.lookup(JIT.array(User)).by("id"));

      expect(source).toContain("for (let i = 0, len = value.length; i < len; i++)");
      expect(source).toContain("return row;");
      expect(source).not.toContain("new Map");
      expect(source).not.toContain(".find(");
      expect(source).not.toContain("Object.keys");
    });

    it("builds no index on the binary path", () => {
      const source = sourceOf(JIT.lookup(JIT.array(User).ordered("id", "asc").uniqueBy("id")));

      expect(source).toContain(">>> 1");
      expect(source).not.toContain("new Map");
      expect(source).not.toContain("__cachedIndex");
    });

    it("reaches the shared cache, not a fresh index, on the keyed path", () => {
      const source = sourceOf(JIT.lookup(JIT.array(User).keyed("id")));

      expect(source).toContain("__cachedIndex(value,");
      expect(source).not.toContain("for (let i = 0, len = value.length");
    });
  });

  /**
   * A standalone lookup and `where(eq).first()` are the same question; the plan
   * requires them to be the same access path, so they must emit the same body.
   */
  it("emits the query terminal's access path, not a second one", () => {
    const keyed = JIT.array(User).keyed("id");
    const first = JIT.cqrs
      .query(keyed)
      .where((query) => query.eq("id", 2))
      .first();
    const artifact = getArtifact(first);

    if (artifact?.kind !== "query-plan") throw new Error("query plan artifact not registered");

    const terminal = Compiler.explainPhysicalQuery(artifact.schema, artifact.program as never);
    const lookupSource = sourceOf(JIT.lookup(keyed));
    const querySource = Compiler.emitQuerySource(artifact.schema, artifact.program as never);
    // The cache key is what makes the two share one index per array. If they
    // ever disagreed, each would silently build and hold its own.
    const cacheKeyOf = (source: string) => /__cachedIndex\(value, ("[^"]+")/.exec(source)?.[1];

    expect(terminal.strategy).toBe("CachedIndexLookup");
    expect(cacheKeyOf(lookupSource)).toBeDefined();
    expect(cacheKeyOf(lookupSource)).toBe(cacheKeyOf(querySource));
  });
});
