import { JIT } from "@jit-compiler/jit/runtime";
import { describe, expect, it } from "vitest";
import { resolveConcepts } from "../graph";
import { resolveSolutions, SOLUTIONS, solutionBlock } from "../solutions";
import { relatedPagesFor } from "../understanding";

/**
 * Values a recipe is allowed to reference without declaring them. A recipe
 * shows the call, not a whole program, so the reader's data is supplied here.
 */
const AMBIENT: Record<string, unknown> = {
  users: [
    { id: "1", role: "admin", score: 90, email: "ada@example.com" },
    { id: "2", role: "user", score: 10, email: "bob@example.com" },
  ],
  payload: { id: "3f98c283-3de3-43a9-9ee8-bd00e3451475", email: "ada@example.com", age: 34 },
  user: { id: "3f98c283-3de3-43a9-9ee8-bd00e3451475", email: "ada@example.com", document: "123", name: "Ada" },
  logger: { info: () => {} },
  consume: () => {},
  socket: {
    on: (event: string, handler: (chunk: unknown) => void) => {
      if (event === "data") handler(new TextEncoder().encode('{"id":"a","amount":1}\n'));
      else handler(undefined);
    },
  },
  previous: { id: "1", total: 1, lines: [{ sku: "a", quantity: 1 }] },
  next: { id: "1", total: 2, lines: [{ sku: "a", quantity: 2 }] },
};

/**
 * The guarantee that makes this file worth having.
 *
 * A recipe is handed to the model as "working code — reproduce it", so a
 * recipe that does not work is a wrong answer with extra confidence attached.
 * The first draft of the streaming entry called `JIT.stream(Row).ndjson()`,
 * which does not exist; this test is what caught it, and it is the only thing
 * that could have, since every name in it looked plausible.
 */
async function run(example: string): Promise<void> {
  const body = example
    .replace(/^\s*import[^\n]*$/gm, "")
    .replace(/\bexport\s+(?=(?:const|let|var|function|class)\b)/g, "");

  const names = Object.keys(AMBIENT);
  const factory = new Function("JIT", ...names, `"use strict";\nreturn (async () => {\n${body}\n})();`) as (
    ...args: unknown[]
  ) => Promise<unknown>;

  await factory(JIT, ...names.map((name) => AMBIENT[name]));
}

describe("the solution playbook", () => {
  it("covers the problems readers actually describe", () => {
    expect(SOLUTIONS.length).toBeGreaterThanOrEqual(8);
    expect(new Set(SOLUTIONS.map((solution) => solution.id)).size).toBe(SOLUTIONS.length);
  });

  it.each(
    SOLUTIONS.map((solution) => [solution.id, solution] as const)
  )("%s runs against the real library", async (_id, solution) => {
    await expect(run(solution.example)).resolves.toBeUndefined();
  });

  it("explains the mechanism rather than asserting the result", () => {
    for (const solution of SOLUTIONS) {
      expect(solution.why.length, solution.id).toBeGreaterThanOrEqual(2);
      expect(solution.problem.length, solution.id).toBeGreaterThan(40);
    }
  });

  it("points at a page that exists in the concept graph's vocabulary", () => {
    for (const solution of SOLUTIONS) {
      expect(solution.page, solution.id).toMatch(/^\/docs\//);
    }
  });
});

describe("resolveSolutions", () => {
  /** The example the whole layer exists for. */
  it("turns a described symptom into the API combination that fixes it", () => {
    const matched = resolveSolutions("meu array tem muitos registros e está lento ao filtrar");

    expect(matched[0]?.id).toBe("slow-filter-large-collection");
    expect(matched[0]?.apis).toContain("JIT.query");
    expect(matched[0]?.apis).toContain("indexBy");
  });

  it("matches the same symptom in English", () => {
    expect(resolveSolutions("filtering this array is slow")[0]?.id).toBe("slow-filter-large-collection");
  });

  it("reaches the CSP recipe from the constraint rather than the API name", () => {
    expect(resolveSolutions("my bundle rejects eval under CSP")[0]?.id).toBe("csp-and-bundle");
  });

  it("finds the masking recipe from a compliance word", () => {
    expect(resolveSolutions("preciso atender a LGPD nos logs")[0]?.id).toBe("pii-in-logs");
  });

  /** A question about the library is not a description of a problem. */
  it("stays quiet when nothing is being described", () => {
    expect(resolveSolutions("o que é a jit?")).toEqual([]);
    expect(resolveSolutions("how does safeParse work?")).toEqual([]);
  });

  it("carries exactly one recipe into the prompt", () => {
    const block = solutionBlock(resolveSolutions("lista grande, filtrar está lento"));

    expect(block).toContain("PROVEN SOLUTION");
    expect(block).toContain("JIT.query");
    expect(block).toContain("Why it works");
  });

  it("says nothing when no recipe matched", () => {
    expect(solutionBlock([])).toBeNull();
  });
});

/**
 * The symbolic links between related nodes: a question about masking should be
 * able to end by naming the boundary it happens at, without the ghost having
 * to guess what is adjacent.
 */
describe("relatedPagesFor", () => {
  it("reaches the neighbours of what the question is about", () => {
    const related = relatedPagesFor(resolveConcepts("como mascarar PII?"));

    expect(related).toContain("/docs/guides/boundary-recipes");
  });

  it("never suggests a page the question is already about", () => {
    const concepts = resolveConcepts("como faço uma query com filtro?");
    const direct = new Set(concepts.filter((match) => match.weight === 1).map((match) => match.id));

    expect(direct.has("query")).toBe(true);
    expect(relatedPagesFor(concepts)).not.toContain("/docs/runtime/queries");
  });

  it("stays short enough to be a suggestion rather than a menu", () => {
    for (const question of ["por que a jit existe?", "como valido um objeto?", "jit vs zod"]) {
      expect(relatedPagesFor(resolveConcepts(question)).length).toBeLessThanOrEqual(3);
    }
  });
});
