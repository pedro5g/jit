import { buildApiChallenges } from "../../tools/quality/api/challenges.js";
import { contractForOperation, type OperationContract } from "../../tools/quality/api/contracts.js";
import { initialState, transition } from "../../tools/quality/api/grammar.js";
import { buildApiInventory } from "../../tools/quality/api/verifier.js";
import type { FluentOperation } from "../../tools/quality/ast/fluent.js";
import { createQualityContext } from "../../tools/quality/core/context.js";

function operation(name: string, family = "builder"): FluentOperation {
  return { name, family, path: "fixture.ts", line: 1, signature: `${name}()` };
}

function contract(name: string, family = "builder"): OperationContract {
  const result = contractForOperation(operation(name, family));
  if (!result) throw new Error(`Missing fixture contract for ${family}.${name}`);
  return result;
}

describe("API grammar", registerApiGrammarTests);

function registerApiGrammarTests(): void {
  describe("transitions", registerTransitionTests);
  describe("semantic challenges", registerSemanticChallengeTests);
  describe("surface inventory", registerInventoryTests);
}

function registerTransitionTests(): void {
  it("rejects repeated singleton operations", () => {
    const first = transition(initialState(), contract("email"));
    const second = transition(first.state, contract("email"));

    expect(first.valid).toBe(true);
    expect(second.valid).toBe(false);
    expect(second.reason).toContain("repeated singleton transition");
  });

  it("keeps accumulated predicates valid and ordered", () => {
    const first = transition(initialState(), contract("refine"));
    const second = transition(first.state, contract("refine"));

    expect(second.valid).toBe(true);
    expect(second.state.operations).toEqual(["refine", "refine"]);
  });

  it("models parse and validation as one composable pipeline", () => {
    const parsed = transition(initialState(), contract("parse", "factory"));
    const validated = transition(parsed.state, contract("validate", "factory"));
    const repeated = transition(validated.state, contract("validate", "factory"));

    expect(parsed.valid).toBe(true);
    expect(validated.valid).toBe(true);
    expect(validated.state.capabilities.has("validated")).toBe(true);
    expect(repeated.valid).toBe(false);
  });

  it("rejects conflicting visibility and terminal continuation", () => {
    const publicState = transition(initialState(), contract("public", "class"));
    const privateState = transition(publicState.state, contract("private", "class"));
    const terminal = transition(initialState(), contract("execute", "cqrs"));
    const continuation = transition(terminal.state, contract("refine"));

    expect(privateState.valid).toBe(false);
    expect(privateState.reason).toContain("visibility");
    expect(continuation.valid).toBe(false);
    expect(continuation.reason).toContain("terminal state");
  });
}

function registerSemanticChallengeTests(): void {
  describe("declared policies", registerDeclaredPolicyTests);
  describe("pipeline constraints", registerPipelineConstraintTests);
}

function registerDeclaredPolicyTests(): void {
  it("turns repeated email into an explicit semantic challenge", () => {
    const challenges = buildApiChallenges([contract("email")]);
    const repeated = challenges.find((item) => item.id === "repeat:jit.validation-check.email");

    expect(repeated).toMatchObject({
      kind: "repeat",
      sequence: ["email", "email"],
      expected: "invalid",
      actual: "invalid",
      status: "verified",
    });
    expect(repeated?.question).toContain("email -> email");
  });

  it("verifies the declared accumulation policy for semantic aliases", () => {
    const challenges = buildApiChallenges([contract("min"), contract("gte")]);
    const alias = challenges.find((item) => item.kind === "alias");

    expect(alias).toMatchObject({
      sequence: ["gte", "min"],
      expected: "valid",
      actual: "valid",
      status: "verified",
    });
    expect(alias?.evidence).toContain("alias semantics: accumulate");
  });

  it("audits only declared representative combinations", () => {
    const challenges = buildApiChallenges([contract("parse", "factory"), contract("validate", "factory")]);
    const combination = challenges.find((item) => item.kind === "combination");

    expect(combination).toMatchObject({
      sequence: ["parse", "validate"],
      expected: "valid",
      actual: "valid",
      status: "verified",
    });
  });

  it("requires every discovered operation to have an explicit repeat policy", () => {
    const challenges = buildApiChallenges([contract("and")]);
    const repeated = challenges.find((item) => item.kind === "repeat");

    expect(repeated).toMatchObject({
      expected: "valid",
      actual: "valid",
      status: "verified",
    });
  });
}

function registerPipelineConstraintTests(): void {
  it("challenges exclusive visibility transitions", () => {
    const challenges = buildApiChallenges([contract("public", "class"), contract("private", "class")]);
    const visibility = challenges.find((item) => item.kind === "exclusive");

    expect(visibility).toMatchObject({
      sequence: ["private", "public"],
      expected: "invalid",
      actual: "invalid",
      status: "verified",
    });
  });

  it("proves the prerequisite and fusion questions for parse and validate", () => {
    const parse = contract("parse", "factory");
    const validate = contract("validate", "factory");
    const challenges = buildApiChallenges([parse, validate]);
    const prerequisite = challenges.find((item) => item.kind === "prerequisite");
    const fusion = challenges.find((item) => item.kind === "fusion");

    expect(prerequisite).toMatchObject({
      sequence: ["validate"],
      expected: "invalid",
      actual: "invalid",
      status: "verified",
    });
    expect(fusion).toMatchObject({
      sequence: ["parse", "validate"],
      expected: "valid",
      actual: "valid",
      status: "verified",
    });
  });

  it("blocks a fusion declaration whose public partner is missing", () => {
    const challenges = buildApiChallenges([contract("validate", "factory")]);

    expect(challenges.some((item) => item.kind === "fusion" && item.status === "blocked")).toBe(true);
  });

  it("keeps the challenge report deterministic", () => {
    const contracts = [
      contract("email"),
      contract("refine"),
      contract("parse", "factory"),
      contract("validate", "factory"),
    ];
    const first = buildApiChallenges(contracts);
    const second = buildApiChallenges([...contracts].reverse());

    expect(second).toEqual(first);
    expect(new Set(first.map((item) => item.id)).size).toBe(first.length);
  });
}

function registerInventoryTests(): void {
  it("classifies every fluent operation discovered from the real TypeScript surface", () => {
    const root = new URL("../..", import.meta.url).pathname;
    const inventory = buildApiInventory(createQualityContext(root, "full"));

    expect(inventory.operations.length).toBeGreaterThan(0);
    expect(inventory.contracts).toHaveLength(inventory.operations.length);
    for (const item of inventory.contracts) expect(item.repeat).toBeTruthy();
  }, 30_000);
}
