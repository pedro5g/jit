import { JIT } from "../../index.js";

describe("JIT mock", () => {
  it("should produce values the compiled validator accepts", () => {
    const User = JIT.object({
      id: JIT.number().int32().positive(),
      email: JIT.string().email(),
      name: JIT.string().min(2).max(20),
      role: JIT.union(JIT.literal("admin"), JIT.literal("member")),
      score: JIT.number().min(0).max(100),
      tags: JIT.array(JIT.string().min(3)).min(1).max(4),
      profile: JIT.object({ bio: JIT.string().nullable() }).optional(),
    });
    const mockUser = JIT.mock(User);
    const isUser = JIT.validate.is(User);

    for (let seed = 1; seed <= 200; seed++) {
      const value = mockUser({ seed });

      expect(isUser(value), `seed ${seed} produced ${JSON.stringify(value)}`).toBe(true);
    }
  });

  it("should be deterministic for a seed and varied without one", () => {
    const Item = JIT.object({ id: JIT.int(), label: JIT.string() });
    const mockItem = JIT.mock(Item);

    expect(mockItem({ seed: 42 })).toEqual(mockItem({ seed: 42 }));
    expect(mockItem({ seed: 42 })).not.toEqual(mockItem({ seed: 43 }));

    const samples = new Set(Array.from({ length: 25 }, () => JSON.stringify(mockItem())));

    expect(samples.size).toBeGreaterThan(1);
  });

  it("should honor numeric bounds, integer-ness and multiples", () => {
    const mockScore = JIT.mock(JIT.number().int32().min(10).max(12));
    const mockStep = JIT.mock(JIT.number().multipleOf(25).min(50).max(200));

    for (let seed = 1; seed <= 50; seed++) {
      const score = mockScore({ seed });

      expect(Number.isInteger(score)).toBe(true);
      expect(score).toBeGreaterThanOrEqual(10);
      expect(score).toBeLessThanOrEqual(12);

      const step = mockStep({ seed });

      expect(step % 25).toBe(0);
      expect(step).toBeGreaterThanOrEqual(50);
      expect(step).toBeLessThanOrEqual(200);
    }
  });

  it("should honor string lengths, affixes and enumerated members", () => {
    const mockCode = JIT.mock(JIT.string().length(6));
    const mockSlug = JIT.mock(JIT.string().startsWith("user-"));
    const mockRole = JIT.mock(JIT.string().oneOf(["admin", "member"] as const));

    for (let seed = 1; seed <= 30; seed++) {
      expect(mockCode({ seed })).toHaveLength(6);
      expect(mockSlug({ seed }).startsWith("user-")).toBe(true);
      expect(["admin", "member"]).toContain(mockRole({ seed }));
    }
  });

  it("should generate every union branch across seeds", () => {
    const Shape = JIT.discriminatedUnion("kind", [
      JIT.object({ kind: JIT.literal("circle"), radius: JIT.number() }),
      JIT.object({ kind: JIT.literal("square"), side: JIT.number() }),
    ]);
    const mockShape = JIT.mock(Shape);
    const kinds = new Set(Array.from({ length: 40 }, (_, seed) => mockShape({ seed: seed + 1 }).kind));

    expect([...kinds].sort()).toEqual(["circle", "square"]);
  });

  it("should terminate on a recursive schema", () => {
    const Node: never = JIT.object({
      value: JIT.number(),
      children: JIT.array(JIT.lazy((): never => Node)).max(2),
    }) as never;
    const mockNode = JIT.mock(Node);

    expect(() => mockNode({ seed: 3 })).not.toThrow();
  });

  it("should emit standalone source with no compiler reference", () => {
    const source = JIT.mock(JIT.object({ id: JIT.int() })).toString();

    expect(source).toContain("function mock(options)");
    expect(source).not.toContain("JIT");
  });
});
