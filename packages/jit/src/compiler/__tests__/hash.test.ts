import { Compiler, JIT } from "../../index.js";

describe("JIT compiler hash", () => {
  it("should expose deterministic specialized hash functions", () => {
    const User = JIT.object({ id: JIT.number(), name: JIT.string() }).schema;
    const hash = Compiler.compileHash(User);

    expect(hash({ id: 1, name: "Ada" })).toBe(hash({ id: 1, name: "Ada" }));
    expect(hash({ id: 1, name: "Ada" })).not.toBe(hash({ id: 2, name: "Ada" }));

    expectTypeOf(hash).parameter(0).toEqualTypeOf<{
      id: number;
      name: string;
    }>();
  });

  it("should emit readable hash source without generic object traversal", () => {
    const User = JIT.object({ id: JIT.number(), name: JIT.string() }).schema;
    const source = Compiler.emitHashSource(User);

    expect(source).toContain("function hash(value)");
    expect(source).toContain("__hashNumber(value.id)");
    expect(source).toContain("__hashString(value.name)");
    expect(source).not.toContain("Object.keys");
  });

  it("should use compiled hash short-circuits in equal functions", () => {
    const User = JIT.object({ id: JIT.number(), name: JIT.string() }).hash("ordered").schema;
    const equal = Compiler.compileEqual(User);
    const source = Compiler.emitEqualSource(User);

    expect(equal({ id: 1, name: "Ada" }, { id: 1, name: "Ada" })).toBe(true);
    expect(equal({ id: 1, name: "Ada" }, { id: 2, name: "Ada" })).toBe(false);
    expect(source).toContain("__hash(l)");
    expect(source).toContain("__hash(r)");
  });

  it("should keep hash short-circuits collision-safe", () => {
    const User = JIT.object({ id: JIT.number(), name: JIT.string() }).hash("ordered").schema;
    const equalSource = Compiler.emitEqualSource(User);
    const diffSource = Compiler.emitDiffSource(User);
    const updateSource = Compiler.emitUpdateSource(User);

    expect(Compiler.compileEqual(User)({ id: 1, name: "Ada" }, { id: 1, name: "Grace" })).toBe(false);
    expect(Compiler.compileDiff(User)({ id: 1, name: "Ada" }, { id: 1, name: "Grace" })).toEqual([
      { type: "update", path: ["name"], value: "Grace" },
    ]);

    expect(equalSource.indexOf("__hash(l)")).toBeLessThan(equalSource.indexOf("l.id"));
    expect(equalSource).toContain("l.name");
    expect(diffSource).not.toContain("__hash");
    expect(updateSource).not.toContain("__hash");
  });

  it("should expose JIT.compileHash as a public convenience API", () => {
    const hash = JIT.compileHash(JIT.object({ id: JIT.number() }).schema);

    expect(hash({ id: 1 })).toBe(hash({ id: 1 }));
    expect(hash({ id: 1 })).not.toBe(hash({ id: 2 }));
  });
});
