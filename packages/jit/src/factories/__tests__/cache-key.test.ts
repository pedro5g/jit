import { Compiler, JIT } from "../../index.js";
import { getArtifact } from "../../runtime/artifact-registry.js";

const Meta = JIT.object({ region: JIT.string(), shard: JIT.number() });
const Row = JIT.object({
  tenantId: JIT.string(),
  id: JIT.number().int(),
  version: JIT.number().int(),
  at: JIT.date(),
  flag: JIT.boolean(),
  note: JIT.optional(JIT.string()),
  meta: Meta,
});
type Row = JIT.Typeof<typeof Row>;

const value: Row = {
  tenantId: "t1",
  id: 7,
  version: 3,
  at: new Date("2026-01-01T00:00:00Z"),
  flag: true,
  note: undefined,
  meta: { region: "eu", shard: 2 },
};

function sourceOf(plan: object): string {
  const artifact = getArtifact(plan);

  if (artifact?.kind !== "cache-key-plan") throw new Error("cache key plan not registered");
  return Compiler.emitCacheKeySource(artifact.descriptor);
}

describe("JIT.cacheKey.string", () => {
  const key = JIT.cacheKey.string(Row).select("tenantId", "id", "version");

  it("builds a key from the named fields", () => {
    expect(key(value)).toBe("t173");
  });

  it("is stable across rebuilt values", () => {
    expect(key({ ...value })).toBe(key(value));
  });

  it("changes when a selected field changes and not otherwise", () => {
    expect(key({ ...value, version: 4 })).not.toBe(key(value));
    expect(key({ ...value, note: "anything", meta: { region: "us", shard: 9 } })).toBe(key(value));
  });

  /** ("a","bc") and ("ab","c") concatenate identically without a separator. */
  it("cannot collide across a field boundary", () => {
    const Pair = JIT.object({ a: JIT.string(), b: JIT.string() });
    const pairKey = JIT.cacheKey.string(Pair).select("a", "b");

    expect(pairKey({ a: "a", b: "bc" })).not.toBe(pairKey({ a: "ab", b: "c" }));
  });

  it("reads a Date as its timestamp and a boolean as a literal", () => {
    const mixed = JIT.cacheKey.string(Row).select("at", "flag");

    expect(mixed(value)).toBe(`${value.at.getTime()}true`);
  });

  it("keeps an absent optional distinguishable from an empty string", () => {
    const withNote = JIT.cacheKey.string(Row).select("note");

    expect(withNote(value)).not.toBe(withNote({ ...value, note: "" }));
  });

  it("follows a dotted path", () => {
    const nested = JIT.cacheKey.string(Row).select("meta.region", "id");

    expect(nested(value)).toBe("eu7");
  });

  it("orders the key by the order the fields were named", () => {
    const forward = JIT.cacheKey.string(Row).select("tenantId", "id");
    const reverse = JIT.cacheKey.string(Row).select("id", "tenantId");

    expect(forward(value)).not.toBe(reverse(value));
  });

  it("refuses more than one structural field rather than serializing them", () => {
    expect(() => JIT.cacheKey.string(Row).select("meta", "meta")).not.toThrow();
    const TwoObjects = JIT.object({ a: Meta, b: Meta });

    expect(() => JIT.cacheKey.string(TwoObjects).select("a", "b")).toThrow(/at most one structural field/);
  });

  describe("generated source", () => {
    /** The whole reason the operation exists. */
    it("never reaches for JSON.stringify", () => {
      const source = sourceOf(key);

      expect(source).not.toContain("JSON.stringify");
      expect(source).not.toContain("Object.keys");
      expect(source).toContain("value.tenantId +");
    });

    it("builds no intermediate object", () => {
      expect(sourceOf(key)).not.toContain("= {");
    });
  });
});

describe("JIT.cacheKey.hash", () => {
  const key = JIT.cacheKey.hash(Row).select("tenantId", "id", "version");

  it("produces a stable 32-bit integer", () => {
    const result = key(value);

    expect(typeof result).toBe("number");
    expect(result | 0).toBe(result);
    expect(key({ ...value })).toBe(result);
  });

  it("changes when a selected field changes", () => {
    expect(key({ ...value, version: 4 })).not.toBe(key(value));
  });

  it("ignores fields it was not given", () => {
    expect(key({ ...value, note: "x", meta: { region: "us", shard: 9 } })).toBe(key(value));
  });

  it("hashes a structural field through the schema's own hash", () => {
    const structural = JIT.cacheKey.hash(Row).select("meta");

    expect(structural(value)).toBe(structural({ ...value, meta: { region: "eu", shard: 2 } }));
    expect(structural(value)).not.toBe(structural({ ...value, meta: { region: "us", shard: 2 } }));
  });

  it("never builds a string", () => {
    const source = sourceOf(key);

    expect(source).not.toContain('"\\u0001"');
    expect(source).not.toContain("JSON.stringify");
    expect(source).toContain("| 0;");
  });
});

describe("the default namespace call", () => {
  it("is the string form", () => {
    expect(JIT.cacheKey(Row).select("id")(value)).toBe(JIT.cacheKey.string(Row).select("id")(value));
  });
});
