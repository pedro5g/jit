import { JIT } from "../../../index.js";
import { resolveEqualStrategy } from "../resolve-strategy.js";

describe("resolveEqualStrategy", () => {
  const User = JIT.object({
    id: JIT.number(),
    name: JIT.string(),
  });

  it("defaults to the plain loop strategy for unhinted arrays", () => {
    const strategy = resolveEqualStrategy(JIT.array(User).schema);

    expect(strategy.type).toBe("equal");
    expect(strategy.array).toEqual({ type: "loop" });
    expect(strategy.hash).toEqual({ type: "none" });
  });

  it("uses the loop strategy for non-array schemas", () => {
    expect(resolveEqualStrategy(User.schema).array).toEqual({ type: "loop" });
    expect(resolveEqualStrategy(JIT.string().schema).array).toEqual({ type: "loop" });
  });

  it("selects the map strategy for indexed entity arrays", () => {
    const Indexed = JIT.array(User).entity({ key: "id" }).indexBy("id");
    const strategy = resolveEqualStrategy(Indexed.schema);

    expect(strategy.array).toEqual({ type: "map", key: "id" });
  });

  it("selects the binary-search strategy for ordered keyed arrays", () => {
    const Ordered = JIT.array(User).ordered("id", "asc");
    const strategy = resolveEqualStrategy(Ordered.schema);

    expect(strategy.array).toEqual({ type: "binary-search", key: "id", direction: "asc" });
  });

  it("omits the direction when ordered() receives none", () => {
    const Ordered = JIT.array(User).ordered("id");
    const strategy = resolveEqualStrategy(Ordered.schema);

    expect(strategy.array).toEqual({ type: "binary-search", key: "id", direction: undefined });
  });

  it("throws when an order hint exists without an identifying key", () => {
    // sortBy() records an order hint but no identify key, which the equal
    // strategy cannot honor.
    const Broken = JIT.array(User).sortBy("id", "asc");

    expect(() => resolveEqualStrategy(Broken.schema)).toThrowError(/ordered\(\) requires a string key/);
  });

  it("enables hash short-circuiting only when a hash hint is present", () => {
    const Hashed = JIT.array(User).hash();
    const strategy = resolveEqualStrategy(Hashed.schema);

    expect(strategy.hash.type).toBe("hash-short-circuit");
  });
});
