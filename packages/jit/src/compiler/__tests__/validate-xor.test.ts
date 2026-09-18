import { JIT } from "../../index.js";

describe("JIT validator exclusive branches", () => {
  it("rebuilds the sole matching XOR branch when it transforms its value", () => {
    const schema = JIT.literal("raw").xor(JIT.string().trim().min(2));
    const parse = JIT.validate.parse(schema);

    expect(parse("  Ada  ")).toBe("Ada");
    expect(() => parse(42)).toThrow(/exactly one schema/i);
  });
});
