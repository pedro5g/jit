import { beforeAll, describe, expect, it, vi } from "vitest";
import { build } from "../../../scripts/knowledge/build.js";
import { ContextService } from "../application/context/context.service.js";
import { QUALIFICATION_CANDIDATES } from "../config/models.js";
import type { GenerationRequest, GenerationResult, LanguageModelPort } from "../core/ports/language-model.js";
import {
  type CapabilityMeasuredCase,
  capabilityManifest,
  capabilityProfile,
  diagnoseCapabilityCase,
  measureCapabilityAnswer,
  runCapabilityBenchmark,
} from "../eval/capability.js";
import { hasProductionProtocolPrompt, minimalSynthesisMessages } from "../eval/capability-prompt.js";
import { explanationCases, resolveExplanationFacets } from "../eval/explanation-cases.js";
import { OracleContextBuilder } from "../eval/oracle-context.js";
import type { KnowledgeEngine } from "../infrastructure/knowledge-engine.js";
import { createKnowledgeEngine } from "../infrastructure/knowledge-engine.js";
import { MemoryArtifactLoader } from "../infrastructure/storage/memory-artifact-loader.js";

describe("capability benchmark", () => {
  let engine: KnowledgeEngine;
  let contextService: ContextService;

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
    contextService = new ContextService({
      knowledge: engine.knowledge,
      routes: engine.routes,
      symbols: engine.symbols,
    });
  }, 120_000);

  it("builds perfect context from the expected route/anchor and strong edges only", () => {
    const testCase = explanationCases()[0];
    const oracle = new OracleContextBuilder({
      knowledge: engine.knowledge,
      graph: engine.graph,
      chunks: engine.chunks,
    }).build({ case: testCase });

    expect(oracle.routeId).toBe("route.docs.concepts.why-jit");
    expect(oracle.anchor).toBe("why-the-generated-code-is-fast");
    expect(oracle.evidence.length).toBeGreaterThan(0);
    expect(
      oracle.evidence.every((evidence) => ["canonical", "parent", "child", "reference"].includes(evidence.relation))
    ).toBe(true);
    expect(oracle.evidence.every((evidence) => evidence.sourceFile.length > 0)).toBe(true);
    expect(oracle.evidenceTokens).toBeLessThanOrEqual(1600);
    expect(testCase.expected.anchor).toBe("why-the-generated-code-is-fast");
  });

  it("does not call retriever or embedder for P", async () => {
    const retrieve = vi.spyOn(engine.retriever, "retrieve").mockRejectedValue(new Error("retrieval must not run"));
    const embed = {
      embed: vi.fn().mockRejectedValue(new Error("embedding must not run")),
      embedAll: vi.fn(),
      dimensions: 384,
      modelId: "fake",
    };
    const model = new OneShotModel("A schema is compiled into a specialized operation.");
    const testCase = resolveExplanationFacets([explanationCases()[0]], engine.knowledge, engine.graph)[0];

    const run = await runCapabilityBenchmark({
      engine,
      contextService,
      model,
      embedder: embed,
      spec: QUALIFICATION_CANDIDATES[0],
      browser: { userAgent: "Chrome" },
      config: "P",
      cases: [testCase],
    });

    expect(retrieve).not.toHaveBeenCalled();
    expect(embed.embed).not.toHaveBeenCalled();
    expect(model.calls).toBe(1);
    expect(run.artifacts.responses[0]?.answer).toBe("A schema is compiled into a specialized operation.");
    expect(run.artifacts.responses[0]?.rawAnswer).toBe(run.artifacts.responses[0]?.answer);
    expect(run.artifacts.responses[0]?.delivery).toBe("model");
    retrieve.mockRestore();
  });

  it("does not retry or fall back when P observes a bad raw answer", async () => {
    const model = new OneShotModel("The JIT was created by Ada Lovelace in 1843 for browser validation.");
    const testCase = resolveExplanationFacets([explanationCases()[0]], engine.knowledge, engine.graph)[0];
    const run = await runCapabilityBenchmark({
      engine,
      contextService,
      model,
      spec: QUALIFICATION_CANDIDATES[0],
      browser: { userAgent: "test" },
      config: "P",
      cases: [testCase],
    });

    expect(model.calls).toBe(1);
    expect(run.artifacts.responses[0]?.answer).toContain("Ada Lovelace");
    expect(run.artifacts.responses[0]?.delivery).toBe("model");
  });

  it("records an explicit length finish as truncation instead of inferring it", async () => {
    const model = new OneShotModel("A cut-off answer", "length");
    const testCase = resolveExplanationFacets([explanationCases()[0]], engine.knowledge, engine.graph)[0];
    const run = await runCapabilityBenchmark({
      engine,
      contextService,
      model,
      spec: QUALIFICATION_CANDIDATES[0],
      browser: { userAgent: "test" },
      config: "P",
      cases: [testCase],
    });

    expect(run.artifacts.manifest.generation.maxTokens).toBe(512);
    expect(run.artifacts.responses[0]).toMatchObject({ finish: "length", truncated: true });
    expect(run.metrics.generation.truncated).toBe(1);
  });

  it("keeps the minimal prompt free of production protocol requirements", () => {
    const testCase = resolveExplanationFacets([explanationCases()[0]], engine.knowledge, engine.graph)[0];
    const oracle = new OracleContextBuilder({
      knowledge: engine.knowledge,
      graph: engine.graph,
      chunks: engine.chunks,
    }).build({
      case: testCase,
    });
    const messages = minimalSynthesisMessages(oracle);
    expect(hasProductionProtocolPrompt(messages)).toBe(false);
    expect(messages.map((message) => message.content).join("\n")).not.toContain("ANSWER_RULES");
    expect(messages.map((message) => message.content).join("\n")).not.toContain("[[go:");
  });

  it("weights core facets above optional details", () => {
    const oracle = {
      question: "why",
      locale: "en",
      routeId: "route.docs.concepts.why-jit",
      evidence: [],
      facets: ["facet.core", "facet.optional-a", "facet.optional-b"],
      facetPriorities: [
        { id: "facet.core", label: "central mechanism", priority: "core" },
        { id: "facet.optional-a", label: "optional detail a", priority: "optional" },
        { id: "facet.optional-b", label: "optional detail b", priority: "optional" },
      ],
      evidenceTokens: 1,
      evidenceLimit: 1600,
      overBudget: false,
    } as never;
    const measurement = {
      audit: {
        findings: [],
        grounding: { coverage: 1, verdict: "fully-grounded" },
      },
      redundancy: 0,
    } as never;
    const result = measureCapabilityAnswer("optional detail a and optional detail b", measurement, oracle);
    expect(result.rawFacetCoverage).toBeGreaterThan(result.weightedFacetCoverage);
    expect(result.coreFacetCoverage).toBe(0);
  });

  it("maps P/R/X outcomes without allowing delivery to hide raw weakness", () => {
    const row = (usable: boolean) =>
      ({ capability: { usableExplanation: usable } }) as unknown as CapabilityMeasuredCase;
    expect(diagnoseCapabilityCase(row(false), row(true), row(true))).toBe("model-capability");
    expect(diagnoseCapabilityCase(row(true), row(false), row(true))).toBe("context-loss");
    expect(diagnoseCapabilityCase(row(true), row(true), row(false))).toBe("protocol-overload");
    expect(diagnoseCapabilityCase(row(true), row(true), row(true))).toBe("production-success");
  });

  it("marks capabilities not established by the explanation suite as unmeasured", () => {
    expect(capabilityProfile([])).toEqual({
      navigation: "unmeasured",
      lookup: "unmeasured",
      explain: "unmeasured",
      deepExplain: "unmeasured",
      groundedSynthesis: "unmeasured",
      portuguese: "unmeasured",
      english: "unmeasured",
    });
  });

  it("diagnoses a raw production rejection even when the explanation itself is usable", () => {
    const usable = () =>
      ({
        capability: { usableExplanation: true },
        measurement: {
          audit: { findings: [{ kind: "missing-source-citation", severity: "fatal" }] },
        },
      }) as unknown as CapabilityMeasuredCase;
    const clean = () => ({ capability: { usableExplanation: true } }) as unknown as CapabilityMeasuredCase;
    expect(diagnoseCapabilityCase(clean(), clean(), usable())).toBe("protocol-overload");
  });

  it("records the experiment boundary in P/R/X manifests", () => {
    const model = QUALIFICATION_CANDIDATES[0];
    const browser = { userAgent: "Chrome" };
    const knowledge = {
      contentHash: "hash",
      embedding: { model: "e5" },
      counts: { chunks: 1, symbols: 1 },
    } as KnowledgeEngine["manifest"];
    expect(capabilityManifest({ config: "P", model, browser, knowledge, cases: 8 })).toMatchObject({
      benchmarkKind: "capability",
      contextSource: "oracle",
      promptKind: "minimal-synthesis",
      retry: false,
      fallback: false,
      citationsRequired: false,
    });
    expect(capabilityManifest({ config: "R", model, browser, knowledge, cases: 8 })).toMatchObject({
      benchmarkKind: "real-context",
      contextSource: "pipeline",
      retry: false,
      fallback: false,
    });
    expect(capabilityManifest({ config: "X", model, browser, knowledge, cases: 8 })).toMatchObject({
      benchmarkKind: "production",
      contextSource: "pipeline",
      promptKind: "production",
      retry: true,
      fallback: true,
      citationsRequired: true,
    });
  });
});

class OneShotModel implements LanguageModelPort {
  readonly id = "fake";
  readonly label = "fake";
  calls = 0;

  constructor(
    private readonly answer: string,
    private readonly finish: GenerationResult["finish"] = "stop"
  ) {}

  generate(_request: GenerationRequest): Promise<GenerationResult> {
    this.calls += 1;
    return Promise.resolve({
      text: this.answer,
      finish: this.finish,
      timings: { ttftMs: 1, totalMs: 2, tokensPerSecond: 1 },
    });
  }

  stream(_request: GenerationRequest, onDelta: (delta: string) => void): Promise<GenerationResult> {
    onDelta(this.answer);
    return this.generate(_request);
  }
}
