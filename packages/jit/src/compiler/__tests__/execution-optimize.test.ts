import * as fc from "fast-check";
import { Compiler, JIT } from "../../index.js";

describe("execution optimizer", () => {
  it("exposes the mandated pass order", () => {
    expect(Compiler.executionOptimizationPasses.map((pass) => pass.name)).toEqual([
      "normalize",
      "inferFacts",
      "normalizeChecks",
      "propagateFacts",
      "removeRedundantChecks",
      "requiredFields",
      "projectionPushdown",
      "deadFields",
      "barriers",
      "materialization",
      "fusion",
      "physicalSpecialization",
    ]);
  });

  it("infers structural proofs only after validation", () => {
    const User = JIT.object({ id: JIT.int().min(1), name: JIT.string(), active: JIT.boolean() });
    const analysis = Compiler.analyzeExecutionPlan(JIT.json.parse(User).validate().plan);
    const decode = analysis.find(({ stage }) => stage.kind === "json.decode");
    const validate = analysis.find(({ stage }) => stage.kind === "validate");

    expect(decode?.factsAfter).toEqual([]);
    expect(validate?.factsAfter).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "Validated" }),
        expect.objectContaining({ kind: "IsObject" }),
        expect.objectContaining({ kind: "NonNull" }),
        expect.objectContaining({ kind: "KnownShape" }),
        expect.objectContaining({ kind: "KnownField", path: ["id"] }),
      ])
    );
  });

  it("marks arbitrary transform callbacks as optimization barriers", () => {
    const User = JIT.object({ name: JIT.string() });
    const analysis = Compiler.analyzeExecutionPlan(
      JIT.from(User).transform(User, { name: (name) => name.trim() }).plan
    );
    const transform = analysis.find(({ stage }) => stage.kind === "transform");

    expect(transform?.effects).toMatchObject({ userCode: true, allocates: true, pure: false });
    expect(transform?.barriers).toEqual(expect.arrayContaining(["user-code", "allocation"]));
  });

  it("removes a repeated pure parse check without changing behavior", () => {
    const User = JIT.object({ id: JIT.int(), name: JIT.string() });
    const repeated = JIT.from(User).validate().validate();
    const optimized = Compiler.optimizeExecutionPlan(repeated.plan);

    expect(repeated.plan.stages.filter((stage) => stage.kind === "validate")).toHaveLength(2);
    expect(optimized.stages.filter((stage) => stage.kind === "validate")).toHaveLength(1);
    expect(repeated({ id: 1, name: "Ada" })).toEqual({ id: 1, name: "Ada" });
  });

  it("differentially matches a manual filtered reduction for arbitrary collections", () => {
    const Row = JIT.object({ id: JIT.int(), active: JIT.boolean(), total: JIT.number() });
    const rows = JIT.array(Row);
    const aggregate = JIT.from(rows)
      .filter((query) => query.eq("active", true))
      .sum("total");

    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            id: fc.integer(),
            active: fc.boolean(),
            total: fc.double({ noNaN: true, noDefaultInfinity: true }),
          }),
          { maxLength: 200 }
        ),
        (values) => {
          let expected = 0;

          for (let index = 0; index < values.length; index++) {
            const value = values[index];

            if (value?.active) expected += value.total;
          }
          expect(aggregate(values)).toBe(expected);
        }
      ),
      { numRuns: 500 }
    );
  });
});
