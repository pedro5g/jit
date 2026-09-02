import { beforeAll, describe, expect, it } from "vitest";
import { build } from "../../../scripts/knowledge/build";
import { buildCoveragePlan } from "../application/coverage/coverage-pipeline";
import { classifyQuestion } from "../application/coverage/question-classifier";
import { explanationCases, resolveExplanationFacets } from "../eval/explanation-cases";
import { createKnowledgeEngine, type KnowledgeEngine } from "../infrastructure/knowledge-engine";
import { MemoryArtifactLoader } from "../infrastructure/storage/memory-artifact-loader";

describe("knowledge expansion and coverage", () => {
  let engine: KnowledgeEngine;

  beforeAll(async () => {
    const result = await build({ embed: false, verifyExamples: false, write: false, quiet: true });
    engine = await createKnowledgeEngine(
      new MemoryArtifactLoader({
        manifest: result.manifest,
        entries: result.entries,
        chunks: result.chunks,
        symbols: result.symbols,
        routes: result.routes,
        relations: result.relations,
        lexical: result.lexical,
      })
    );
  }, 120_000);

  it("ships a deterministic graph with inspectable source reasons", () => {
    expect(engine.graph.all().length).toBeGreaterThan(engine.knowledge.all().length);
    expect(new Set(engine.graph.all().map((edge) => edge.source))).toEqual(
      expect.objectContaining(new Set(["heading-hierarchy", "route-hierarchy", "shared-symbol"]))
    );
    expect(engine.graph.all().every((edge) => edge.from !== edge.to)).toBe(true);
  });

  it("bounds a cyclic, bidirectional neighbourhood", async () => {
    const report = await engine.retriever.retrieve("por que a JIT é tão rápida?", {
      context: { locale: "pt-BR" },
    });
    const plan = buildCoveragePlan(engine, "por que a JIT é tão rápida?", report, "pt-BR");
    const ids = plan.expansion.candidates.map((candidate) => candidate.knowledgeId);

    expect(plan.scope).toBe("broad");
    expect(plan.expansion.candidates.length).toBeLessThanOrEqual(30);
    expect(plan.expansion.candidates.every((candidate) => candidate.depth <= 2)).toBe(true);
    expect(new Set(ids).size).toBe(ids.length);
    expect(plan.readiness.sufficient).toBe(true);
  });

  it("derives the acceptance facets from source metadata and covers most of them", async () => {
    const testCase = resolveExplanationFacets(explanationCases(), engine.knowledge, engine.graph)[0];
    const report = await engine.retriever.retrieve(testCase.question, { context: { locale: testCase.locale } });
    const plan = buildCoveragePlan(engine, testCase.question, report, testCase.locale);
    const expected = new Set(testCase.expected.facets);
    const found = plan.selectedFacetIds.filter((facet) => expected.has(facet)).length;

    expect(expected.size).toBeGreaterThanOrEqual(5);
    expect(found / expected.size).toBeGreaterThanOrEqual(0.8);
  });

  it("classifies by task shape rather than by a model tier or a named topic", async () => {
    const broad = await engine.retriever.retrieve("how does this engine work?", { context: { locale: "en" } });
    const lookup = await engine.retriever.retrieve("what does JIT.validate.safeParse do?", {
      context: { locale: "en" },
    });
    expect(classifyQuestion("how does this engine work?", broad).scope).toBe("broad");
    expect(classifyQuestion("what does JIT.validate.safeParse do?", lookup)).toEqual({
      scope: "lookup",
      answerMode: "lookup",
    });
    expect(classifyQuestion("how does generated code become faster?", broad).answerMode).toBe("explain");
    expect(classifyQuestion("write a code example for validation", broad).answerMode).toBe("code");
  });

  it("recognizes broad conceptual wording without turning focused how-to questions into explanations", async () => {
    const conceptual = await engine.retriever.retrieve("what does compiled data engine mean?", {
      context: { locale: "en" },
    });
    const howTo = await engine.retriever.retrieve("how do I validate a uuid?", { context: { locale: "en" } });

    expect(classifyQuestion("what does compiled data engine mean?", conceptual)).toEqual({
      scope: "broad",
      answerMode: "explain",
    });
    expect(classifyQuestion("how do I validate a uuid?", howTo).scope).not.toBe("broad");
  });
});
