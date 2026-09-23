import { Compiler, JIT } from "../../index.js";
import { deriveSchemaFacts } from "../facts/schema-facts.js";
import { resolvePhysicalPlan } from "../physical/physical-plan.js";
import { resolveArrayValidationStrategy } from "../strategy/families/array-validation.js";
import { resolveEnumMembershipStrategy } from "../strategy/families/enum-membership.js";
import { resolveMembershipStrategy } from "../strategy/families/membership.js";
import { resolveTargetProfile } from "../target/resolve-target.js";

describe("adaptive compiler fixed arrays", () => {
  it("selects a target-aware unrolled strategy for a small fixed array", () => {
    const schema = JIT.array(JIT.string()).min(5).max(5);
    const artifact = JIT.validate.is(schema);
    const physical = artifact.explain({ physical: true });
    const decision = physical.decisions.find((candidate) => candidate.family === "array.validate");
    const source = Compiler.emitValidatorSource(schema.schema, { ops: ["is"] });

    expect(decision).toMatchObject({
      strategy: "unrolled",
      evidence: ["PERF-ARRAY-001"],
    });
    expect(source).toContain("v1[0]");
    expect(source).not.toContain("for (let");
    expect(artifact(["a", "b", "c", "d", "e"])).toBe(true);
    expect(artifact(["a", "b", 3, "d", "e"])).toBe(false);
  });

  it("keeps a loop when the fixed array body is too expensive to unroll", () => {
    const element = JIT.object({ id: JIT.number(), name: JIT.string() });
    const schema = JIT.array(element).length(5);
    const decision = resolveArrayValidationStrategy(schema.schema, resolveTargetProfile(), "predicate");
    const source = Compiler.emitValidatorSource(schema.schema, { ops: ["is"] });

    expect(decision?.strategy).toBe("indexed-loop");
    expect(source).toContain("for (let");
  });
});

describe("adaptive compiler enum membership", () => {
  it("records enum decisions without changing the external representation", () => {
    const Status = JIT.enum(["draft", "review", "published", "archived", "deleted"] as const);
    const profile = resolveTargetProfile();
    const decision = resolveEnumMembershipStrategy(Status.schema, profile);
    const physical = resolvePhysicalPlan(JIT.validate.is(Status).plan, profile);

    expect(decision?.family).toBe("enum.membership");
    expect(physical.decisions).toContainEqual(decision);
    expect(JIT.validate.is(Status)("published")).toBe(true);
    expect(JIT.validate.is(Status)(2)).toBe(false);
  });

  it("uses a null-prototype lookup without confusing inherited keys", () => {
    const Status = JIT.enum(["toString", "draft", "review", "published", "archived", "deleted", "closed"] as const);
    const validator = JIT.validate.is(Status);
    const source = Compiler.emitValidatorSource(Status.schema, { ops: ["is"] });

    expect(resolveEnumMembershipStrategy(Status.schema, resolveTargetProfile())?.strategy).toBe("lookup-object");
    expect(source).toContain("Object.create(null)");
    expect(validator("toString")).toBe(true);
    expect(validator("hasOwnProperty")).toBe(false);
  });

  it("uses a switch for medium numeric enums while preserving values", () => {
    const Status = JIT.enum([10, 20, 30, 40, 50, 60, 70, 80] as const);
    const validator = JIT.validate.is(Status);
    const source = Compiler.emitValidatorSource(Status.schema, { ops: ["is"] });

    expect(resolveEnumMembershipStrategy(Status.schema, resolveTargetProfile())?.strategy).toBe("switch");
    expect(source).toContain("switch (v1)");
    expect(validator(70)).toBe(true);
    expect(validator(75)).toBe(false);
  });
});

describe("adaptive compiler facts and capabilities", () => {
  it("exposes semantic facts separately from physical decisions", () => {
    const schema = JIT.object({
      status: JIT.enum(["draft", "published"] as const),
      tags: JIT.array(JIT.string()).length(2),
    });
    const facts = deriveSchemaFacts(schema.schema);
    const physical = JIT.validate.is(schema).explain({ physical: true });

    expect(facts.some((fact) => fact.kind === "StableShape")).toBe(true);
    expect(facts.some((fact) => fact.kind === "KnownField" && fact.path[fact.path.length - 1] === "status")).toBe(true);
    expect(physical.decisions.map((decision) => decision.family)).toEqual(["enum.membership", "array.validate"]);
  });

  it("does not trade deep equality for a native membership shortcut", () => {
    const profile = resolveTargetProfile({ profile: "v8-99" });
    const deep = resolveMembershipStrategy({ cardinality: 100, lookupCount: 1, equality: "deep" }, profile);
    const repeated = resolveMembershipStrategy(
      { cardinality: 100, lookupCount: 10, reuse: "repeated", equality: "same-value-zero" },
      profile
    );

    expect(deep.strategy).toBe("nested-scan");
    expect(repeated.strategy).toBe("set-lookup");
  });

  it("keeps reusable indexes as physical capabilities instead of semantic facts", () => {
    const User = JIT.object({ id: JIT.string(), name: JIT.string() });
    const Users = JIT.array(User).keyed("id");
    const physical = JIT.validate.is(Users).explain({ physical: true });

    expect(physical.capabilities).toContainEqual({
      kind: "index",
      key: "id",
      sourceStage: 0,
      reusable: true,
    });
  });
});
