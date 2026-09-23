import fc from "fast-check";
import { Compiler, JIT } from "../../index.js";
import { deriveSchemaFacts } from "../facts/schema-facts.js";
import { createPerformanceProfile, type PerformanceProfile } from "../performance/profile.js";
import { resolvePhysicalPlan, resolveValidationPhysicalPlan } from "../physical/physical-plan.js";
import { resolveArrayValidationStrategy } from "../strategy/families/array-validation.js";
import { resolveEnumMembershipStrategy } from "../strategy/families/enum-membership.js";
import { resolveMembershipStrategy } from "../strategy/families/membership.js";
import { resolveTupleValidationStrategy } from "../strategy/families/tuple-validation.js";
import { portableProfile } from "../target/portable-profile.js";
import { resolveTargetProfile } from "../target/resolve-target.js";
import type { TargetProfile } from "../target/target-profile.js";
import { createNodeProfile } from "../target/v8/profile.js";
import { emitValidator } from "../validate/emit-validator-entry.js";

const arrayEvidence = createPerformanceProfile({ id: "test-array", version: "1", evidence: ["PERF-ARRAY-001"] });
const enumEvidence = createPerformanceProfile({
  id: "test-enum",
  version: "1",
  evidence: ["PERF-ENUM-001", "PERF-ENUM-002", "PERF-ENUM-003"],
});
const membershipEvidence = createPerformanceProfile({
  id: "test-membership",
  version: "1",
  evidence: ["PERF-MEMBER-001", "PERF-MEMBER-002"],
});

describe("adaptive compiler fixed arrays", () => {
  it("keeps unrolling disabled until measured evidence is admitted", () => {
    const schema = JIT.array(JIT.string()).min(5).max(5);
    const artifact = JIT.validate.is(schema);
    const physical = artifact.explain({ physical: true });
    const decision = physical.decisions.find((candidate) => candidate.family === "array.validate");
    const source = Compiler.emitValidatorSource(schema.schema, { ops: ["is"] });

    const optimized = emitValidator(schema.schema, {
      is: true,
      safeParse: false,
      safeParseAsync: false,
      target: { profile: "node-26" },
      performance: arrayEvidence,
    });
    expect(decision).toMatchObject({
      strategy: "indexed-loop",
      evidence: [],
      considered: expect.arrayContaining([
        expect.objectContaining({ strategy: "unrolled", status: "insufficient-evidence" }),
      ]),
    });
    expect(source).toContain("for (let");
    expect(optimized.source).not.toContain("for (let");
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
    const optimized = emitValidator(Status.schema, {
      is: true,
      safeParse: false,
      safeParseAsync: false,
      performance: enumEvidence,
    });
    const optimizedValidator = runEmittedIs(optimized);

    expect(resolveEnumMembershipStrategy(Status.schema, resolveTargetProfile(), enumEvidence)?.strategy).toBe(
      "lookup-object"
    );
    expect(source).not.toContain("Object.create(null)");
    expect(optimized.source).toContain("Object.create(null)");
    expect(validator("toString")).toBe(true);
    expect(validator("hasOwnProperty")).toBe(false);
    expect(optimizedValidator("toString")).toBe(true);
    expect(optimizedValidator("hasOwnProperty")).toBe(false);

    let coerced = false;
    const coercible = {
      toString: () => {
        coerced = true;
        return "toString";
      },
    };
    expect(optimizedValidator(coercible)).toBe(false);
    expect(coerced).toBe(false);
  });

  it("uses a switch for medium numeric enums while preserving values", () => {
    const Status = JIT.enum([10, 20, 30, 40, 50, 60, 70, 80] as const);
    const validator = JIT.validate.is(Status);
    const source = Compiler.emitValidatorSource(Status.schema, { ops: ["is"] });
    const optimized = emitValidator(Status.schema, {
      is: true,
      safeParse: false,
      safeParseAsync: false,
      performance: enumEvidence,
    });
    const optimizedValidator = runEmittedIs(optimized);

    expect(resolveEnumMembershipStrategy(Status.schema, resolveTargetProfile(), enumEvidence)?.strategy).toBe("switch");
    expect(source).not.toContain("switch (v1)");
    expect(optimized.source).toContain("switch (v1)");
    expect(validator(70)).toBe(true);
    expect(validator(75)).toBe(false);
    expect(optimizedValidator(70)).toBe(true);
    expect(optimizedValidator(75)).toBe(false);
  });
});

describe("adaptive compiler tuples", () => {
  it("plans heterogeneous fixed tuples as positional checks", () => {
    const schema = JIT.tuple(JIT.string(), JIT.number(), JIT.boolean());
    const decision = resolveTupleValidationStrategy(schema.schema, createNodeProfile("26"));
    const physical = resolveValidationPhysicalPlan(schema.schema, "is", { profile: "node-26" });
    const source = Compiler.emitValidatorSource(schema.schema, { ops: ["is"] });

    expect(resolveArrayValidationStrategy(schema.schema, createNodeProfile("26"))).toBeUndefined();
    expect(decision).toMatchObject({ family: "tuple.fixed.validate", strategy: "positional-checks" });
    expect(physical.decisions.map((item) => item.family)).toEqual(["tuple.fixed.validate"]);
    expect(source).toContain("v1[0]");
    expect(source).toContain("v1[2]");
    expect(JIT.validate.is(schema)(["name", 3, true])).toBe(true);
    expect(JIT.validate.is(schema)(["name", "3", true])).toBe(false);
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
      profile,
      membershipEvidence
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

describe("adaptive optimizer determinism", () => {
  it("repeats the same physical plan and digest for identical inputs", () => {
    const schema = JIT.array(JIT.string()).length(5);
    const plan = JIT.validate.is(schema).plan;
    const first = resolvePhysicalPlan(plan, { profile: "node-26" });
    const repeated = Array.from({ length: 100 }, () => resolvePhysicalPlan(plan, { profile: "node-26" }));

    expect(repeated.every((candidate) => candidate.digest === first.digest)).toBe(true);
    expect(repeated.every((candidate) => JSON.stringify(candidate.decisions) === JSON.stringify(first.decisions))).toBe(
      true
    );
  });

  it("includes semantic schema constraints and target profile in the physical digest", () => {
    const short = JIT.array(JIT.string()).length(4);
    const long = JIT.array(JIT.string()).length(5);

    const portable = resolveValidationPhysicalPlan(long.schema, "is", { profile: "portable-1" });
    const node26 = resolveValidationPhysicalPlan(long.schema, "is", { profile: "node-26" });
    const changedContract = resolveValidationPhysicalPlan(short.schema, "is", { profile: "portable-1" });

    expect(portable.digest).not.toBe(node26.digest);
    expect(portable.digest).not.toBe(changedContract.digest);
  });

  it("keeps descriptive annotation metadata outside the physical digest", () => {
    const schema = JIT.array(JIT.string()).length(5).schema;
    const metadataOnly = {
      ...schema,
      annotations: { ...schema.annotations, metadata: { title: "descriptive" } },
    } as typeof schema;

    expect(resolveValidationPhysicalPlan(metadataOnly, "is", { profile: "portable-1" }).digest).toBe(
      resolveValidationPhysicalPlan(schema, "is", { profile: "portable-1" }).digest
    );
  });
});

describe("adaptive optimizer differential semantics", () => {
  it("compares fixed-array strategies against the same semantic oracle", () => {
    const schema = JIT.array(JIT.string()).length(5);
    const indexedLoop = compileIs(schema.schema, portableProfile);
    const unrolled = compileIs(schema.schema, createNodeProfile("26"), arrayEvidence);
    const runtime = JIT.validate.is(schema);
    const oracle = (value: unknown): boolean => {
      if (!Array.isArray(value) || value.length !== 5) return false;
      for (let index = 0; index < value.length; index++) if (typeof value[index] !== "string") return false;
      return true;
    };

    expect(resolveArrayValidationStrategy(schema.schema, portableProfile)?.strategy).toBe("indexed-loop");
    expect(
      resolveArrayValidationStrategy(schema.schema, createNodeProfile("26"), "predicate", arrayEvidence)?.strategy
    ).toBe("unrolled");
    fc.assert(
      fc.property(fc.anything({ maxDepth: 2 }), (value: unknown) => {
        const expected = oracle(value);
        expect(indexedLoop(value)).toBe(expected);
        expect(unrolled(value)).toBe(expected);
        expect(runtime(value)).toBe(expected);
      })
    );
  });

  it("compares enum candidates with strict-membership semantics", () => {
    const strings = ["__proto__", "constructor", "toString", "hasOwnProperty", "draft", "review", "published"] as const;
    const numbers = [10, 20, 30, 40, 50, 60, 70, 80] as const;
    const stringSchema = JIT.enum(strings);
    const numericSchema = JIT.enum(numbers);
    const lookup = compileIs(stringSchema.schema, createNodeProfile("26"), enumEvidence);
    const direct = compileIs(JIT.enum(["only"] as const).schema, portableProfile, enumEvidence);
    const switched = compileIs(numericSchema.schema, createNodeProfile("26"), enumEvidence);
    const values = fc.anything({ maxDepth: 2 });

    expect(resolveEnumMembershipStrategy(stringSchema.schema, createNodeProfile("26"), enumEvidence)?.strategy).toBe(
      "lookup-object"
    );
    expect(resolveEnumMembershipStrategy(numericSchema.schema, createNodeProfile("26"), enumEvidence)?.strategy).toBe(
      "switch"
    );
    fc.assert(
      fc.property(values, (value: unknown) => {
        expect(lookup(value)).toBe(strings.some((candidate) => candidate === value));
        expect(direct(value)).toBe(value === "only");
        expect(switched(value)).toBe(numbers.some((candidate) => candidate === value));
      })
    );
  });
});

function compileIs(
  schema: Parameters<typeof emitValidator>[0],
  target: TargetProfile,
  performance?: PerformanceProfile
): (value: unknown) => boolean {
  const emitted = emitValidator(schema, {
    is: true,
    safeParse: false,
    safeParseAsync: false,
    target,
    ...(performance === undefined ? {} : { performance }),
  });
  return runEmittedIs(emitted);
}

function runEmittedIs(emitted: ReturnType<typeof emitValidator>): (value: unknown) => boolean {
  const output = globalThis.Function(...emitted.bindings.names, emitted.source)(...emitted.bindings.values) as {
    readonly is: (value: unknown) => boolean;
  };
  return output.is;
}
