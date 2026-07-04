import { Compiler, Errors, JIT } from "../../index.js";

describe("JIT compiler pipeline", () => {
  it("should compile object field transforms from schema chains", () => {
    const User = JIT.object({
      id: JIT.number(),
      name: JIT.string(),
    }).transform({
      name: (value) => value.toUpperCase(),
    });
    const pipeline = Compiler.compilePipeline(User.schema);
    const source = Compiler.emitPipelineSource(User.schema);

    expect(pipeline({ id: 1, name: "Ada" })).toEqual({ id: 1, name: "ADA" });
    expect(source).toContain("__p0(out.name, out)");
    expect(source).not.toContain("toUpperCase");
  });

  it("should compile coerce, pipe, and refine with external bindings", () => {
    const schema = JIT.number()
      .coerce((value) => Number(value))
      .pipe((value) => value + 1)
      .refine((value) => value > 1).schema;
    const pipeline = Compiler.compilePipeline(schema);
    const source = Compiler.emitPipelineSource(schema);

    expect(pipeline("41")).toBe(42);
    expect(() => pipeline("0")).toThrow(Errors.JITError);
    expect(source).toContain("out = __p0(out);");
    expect(source).toContain("out = __p1(out);");
    expect(source).toContain("if (!__p2(out))");
    expect(source).not.toContain("Number(");
  });
});
