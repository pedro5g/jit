import { emitExpr } from "../../compiler/emitter/emit-expr.js";
import { lowerExtensionIR } from "../../compiler/extension-lowering.js";
import { type IRExpr, type IRNode, type IRProgram, irVar, not, typeOfIs } from "../../compiler/ir/ir.js";
import { optimizeCost } from "../../compiler/ir/optimizer/cost/optimize-cost.js";
import { optimizeIRWith } from "../../compiler/ir/optimizer/optimize-ir.js";
import { inlineVars } from "../../compiler/ir/optimizer/passes/inline-vars.js";
import { normalizeLogic } from "../../compiler/ir/optimizer/passes/normalize-logic.js";
import { reorderCompares } from "../../compiler/ir/optimizer/passes/reorder-compares.js";
import { reorderConditions } from "../../compiler/ir/optimizer/passes/reorder-conditions.js";
import { resolveValidationPhysicalPlan } from "../../compiler/physical/physical-plan.js";
import { portableProfile } from "../../compiler/target/portable-profile.js";
import { JIT } from "../../index.js";
import { assertSemanticExtensionConformance, assertStrategyExtensionConformance } from "../conformance.js";
import { validateExtensionIR } from "../extension-ir.js";
import { createExtensionSet } from "../extension-set.js";
import { plugin } from "../plugin.js";

const activeValue = {
  version: 1 as const,
  nodes: [
    { kind: "load" as const, path: ["status"] },
    { kind: "literal" as const, value: "active" },
    { kind: "compare" as const, operator: "eq" as const, left: 0, right: 1 },
    { kind: "return" as const, value: 2 },
  ],
  result: 3,
};

describe("restricted extension IR normalization and validation", () => {
  it("normalizes constants and object keys before computing a stable digest", () => {
    const first = validateExtensionIR({
      version: 1,
      nodes: [{ kind: "emitIssue", code: "INVALID_VALUE", params: { b: 2, a: { y: 1, x: 0 } } }, { kind: "return" }],
      result: 1,
      effects: ["issues"],
    });
    const second = validateExtensionIR({
      version: 1,
      nodes: [{ kind: "emitIssue", code: "INVALID_VALUE", params: { a: { x: 0, y: 1 }, b: 2 } }, { kind: "return" }],
      result: 1,
      effects: ["issues"],
    });

    expect(first.digest).toBe(second.digest);
    expect(Object.isFrozen(first.ir.nodes)).toBe(true);
    const issue = first.ir.nodes[0];
    expect(issue?.kind === "emitIssue" && Object.isFrozen(issue.params)).toBe(true);
  });

  it("rejects malformed references, type-invalid logic, nonportable values, and emitter fields", () => {
    expect(() =>
      validateExtensionIR({ version: 1, nodes: [{ kind: "compare", operator: "eq", left: 4, right: 0 }], result: 0 })
    ).toThrow(/outside its node list/);
    expect(() =>
      validateExtensionIR({
        version: 1,
        nodes: [
          { kind: "literal", value: "no" },
          { kind: "logical", operator: "and", operands: [0, 0] },
          { kind: "return", value: 1 },
        ],
        result: 2,
      })
    ).toThrow(/must be boolean/);
    expect(() =>
      validateExtensionIR({
        version: 1,
        nodes: [
          { kind: "literal", value: 1 },
          { kind: "emitIssue", code: "INVALID", params: { value: Number.NaN } },
          { kind: "return" },
        ],
        result: 2,
        effects: ["issues"],
      })
    ).toThrow(/non-finite/);
    expect(() =>
      validateExtensionIR({ version: 1, nodes: [{ kind: "return", source: "return true" }], result: 0 } as never)
    ).toThrow(/unsupported field/);
  });
});

describe("semantic extension lowering", () => {
  it("lowers a semantic plugin through the shared core IR and conformance path", () => {
    const extension = plugin.semantic({
      id: "@fixture/active-status",
      version: "1.0.0",
      abi: 1,
      name: "activeStatus",
      grammar: { repeat: "forbid" },
      lower: () => activeValue,
    });

    assertSemanticExtensionConformance({
      extension,
      context: { schema: { type: "object" }, facts: [], metadata: {} },
      cases: [
        { value: { status: "active" }, expected: true },
        { value: { status: "inactive" }, expected: false },
        { value: {}, expected: false },
      ],
    });
    expect(createExtensionSet([extension]).plugins[0]).toMatchObject({ id: extension.id, version: extension.version });
  });
});

describe("semantic intrinsic optimizer coverage", () => {
  it("runs extension typeof and array intrinsics through optimizer and emitter passes", () => {
    const stringCheck = lowerExtensionIR({
      version: 1,
      nodes: [
        { kind: "load", path: ["label"] },
        { kind: "callIntrinsic", name: "isString", args: [0] },
        { kind: "return", value: 1 },
      ],
      result: 2,
    }).body[0];
    const arrayCheck = lowerExtensionIR({
      version: 1,
      nodes: [
        { kind: "load", path: ["items"] },
        { kind: "callIntrinsic", name: "isArray", args: [0] },
        { kind: "return", value: 1 },
      ],
      result: 2,
    }).body[0];
    const stringExpr = stringCheck?.kind === "return" ? stringCheck.value : undefined;
    const arrayExpr = arrayCheck?.kind === "return" ? arrayCheck.value : undefined;
    if (stringExpr === undefined || arrayExpr === undefined)
      throw new Error("intrinsic extension did not return an expression");

    const program: IRProgram = {
      kind: "program",
      params: [irVar("value")],
      body: [
        { kind: "assign", target: irVar("isString"), expr: stringExpr },
        { kind: "assign", target: irVar("isArray"), expr: arrayExpr },
        {
          kind: "if",
          test: not(irVar("isString")),
          then: [{ kind: "return", value: { kind: "literal", value: false } }],
        },
        {
          kind: "if",
          test: not(irVar("isArray")),
          then: [{ kind: "return", value: { kind: "literal", value: false } }],
        },
        { kind: "return", value: { kind: "nary", op: "and", operands: [stringExpr, arrayExpr] } },
      ],
    };
    const optimized = optimizeIRWith(program, [
      inlineVars,
      optimizeCost,
      normalizeLogic,
      reorderCompares,
      reorderConditions,
    ]);
    const conditions = optimized.body.filter(
      (node): node is Extract<IRNode, { readonly kind: "if" }> => node.kind === "if"
    );
    if (conditions.length !== 2) throw new Error("optimized extension checks lost their guards");
    const output = optimized.body[optimized.body.length - 1];
    if (output?.kind !== "return") throw new Error("optimized extension check lost its result");
    const predicate = globalThis.Function("value", `return ${emitExpr(output.value)};`) as (value: unknown) => boolean;

    expect(predicate({ label: "text", items: [] })).toBe(true);
    expect(predicate({ label: 42, items: [] })).toBe(false);
    expect(predicate({ label: "text", items: 42 })).toBe(false);
    expect(emitExpr(stringExpr)).toBe('typeof value.label === "string"');
    expect(emitExpr(arrayExpr)).toBe("Array.isArray(value.items)");
    expect(emitExpr(typeOfIs(irVar("value"), "string"))).toBe('typeof value === "string"');
    expect(optimized).not.toBe(program);
    assertExtensionCostParity(stringExpr, arrayExpr);
  });
});

describe("semantic metadata dependencies", () => {
  it("applies semantic extensions to runtime validation and digests only declared metadata", () => {
    const extension = JIT.plugin.semantic({
      id: "@fixture/metadata-gate",
      version: "1.0.0",
      abi: 1,
      name: "metadataGate",
      metadataDependencies: ["custom"],
      grammar: { repeat: "forbid" },
      lower: ({ metadata }) => ({
        version: 1,
        nodes: [
          {
            kind: "literal",
            value: (metadata.custom as { readonly accepted?: unknown } | undefined)?.accepted === true,
          },
          { kind: "return", value: 0 },
        ],
        result: 1,
      }),
    });
    const Extended = JIT.$extends(extension);
    const accepted = Extended.object({ id: Extended.string() }).meta({ custom: { accepted: true }, title: "one" });
    const sameExecutableMetadata = Extended.object({ id: Extended.string() }).meta({
      custom: { accepted: true },
      title: "two",
    });
    const rejected = Extended.object({ id: Extended.string() }).meta({ custom: { accepted: false }, title: "one" });
    const isAccepted = Extended.validate.is(accepted);

    expect(isAccepted({ id: "u1" })).toBe(true);
    expect(isAccepted(null)).toBe(false);
    expect(Extended.validate.safeParse(rejected)({ id: "u1" })).toMatchObject({
      success: false,
      issues: [{ code: "custom", expected: "semantic extension" }],
    });
    expect(resolveValidationPhysicalPlan(accepted.schema, "is", portableProfile).digest).toBe(
      resolveValidationPhysicalPlan(sameExecutableMetadata.schema, "is", portableProfile).digest
    );
    expect(resolveValidationPhysicalPlan(accepted.schema, "is", portableProfile).digest).not.toBe(
      resolveValidationPhysicalPlan(rejected.schema, "is", portableProfile).digest
    );
  });
});

describe("strategy extension conformance", () => {
  it("checks strategy extension contracts without exposing a source writer", () => {
    const extension = plugin.strategy({
      id: "@fixture/membership-candidate",
      version: "1.0.0",
      abi: 1,
      family: "membership.lookup",
      candidate: "fixture-candidate",
      optimized: true,
      portability: "portable",
      evidence: ["PERF-MEMBER-001"],
      grammar: { repeat: "forbid" },
      legality: () => ({ supported: true, reason: "strict primitive keys" }),
      targetSupport: () => ({ supported: true, reason: "portable comparison" }),
      estimate: () => ({ runtime: 100, allocation: 0, setup: 0, codeSize: 20, cold: 10, branches: 1 }),
      lower: () => activeValue,
    });

    assertStrategyExtensionConformance({
      extension,
      context: { family: "membership.lookup", facts: [], equality: "strict" },
      target: portableProfile,
    });
    expect(createExtensionSet([extension]).plugins[0]).toMatchObject({ candidate: "fixture-candidate" });
    expect(extension).not.toHaveProperty("emit");
    expect(extension).not.toHaveProperty("source");
  });
});

function assertExtensionCostParity(stringExpr: IRExpr, arrayExpr: IRExpr): void {
  const failure = (test: IRExpr): IRNode => ({
    kind: "if",
    test: not(test),
    then: [{ kind: "return", value: { kind: "literal", value: false } }],
  });
  const program: IRProgram = {
    kind: "program",
    params: [irVar("value")],
    body: [failure(stringExpr), failure(arrayExpr), { kind: "return", value: { kind: "literal", value: true } }],
  };
  const costed = optimizeCost(program);
  const reordered = reorderCompares(costed);
  const guards = reordered.body.filter((node): node is Extract<IRNode, { readonly kind: "if" }> => node.kind === "if");
  if (guards.length !== 2) throw new Error("optimizer discarded an intrinsic guard");
  const predicate = globalThis.Function(
    "value",
    `return ${guards.map(({ test }) => `!(${emitExpr(test)})`).join(" && ")};`
  ) as (value: unknown) => boolean;

  expect(predicate({ label: "text", items: [] })).toBe(true);
  expect(predicate({ label: 42, items: [] })).toBe(false);
  expect(predicate({ label: "text", items: 42 })).toBe(false);
}
