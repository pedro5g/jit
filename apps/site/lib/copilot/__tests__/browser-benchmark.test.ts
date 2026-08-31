import { beforeAll, describe, expect, it } from "vitest";
import { build } from "../../../scripts/knowledge/build";
import { ContextService } from "../application/context/context.service";
import { GENERATION_MODELS, type GenerationModelSpec } from "../config/models";
import type { GenerationRequest, GenerationResult, LanguageModelPort } from "../core/ports/language-model";
import { CONTEXT_VERSION, DATASET_VERSION, PROMPT_VERSION, type RunArtifacts } from "../eval/artifacts";
import { describeBrowser } from "../eval/browser-environment";
import { browserManifest, runBrowserBenchmark } from "../eval/browser-run";
import { packBundle, parseBundle } from "../eval/bundle";
import { measureGeneration } from "../eval/detectors";
import { generationCases } from "../eval/generation-cases";
import { renderReport } from "../eval/report";
import { createKnowledgeEngine, type KnowledgeEngine } from "../infrastructure/knowledge-engine";
import { MemoryArtifactLoader } from "../infrastructure/storage/memory-artifact-loader";

/**
 * §PART 26's browser run, exercised with no browser and no weights.
 *
 * What is worth testing here is not the page: it is that a run produced in a
 * browser arrives on disk as the same artifact every other run is, and that a
 * partial one — the reader closed the tab, the machine ran out of memory —
 * still satisfies the consistency the manifest promises. A run that imported
 * with a manifest disagreeing with its rows is exactly the unfalsifiable
 * transcript the whole format exists to prevent.
 */

const LIGHT = GENERATION_MODELS.find((model) => model.tier === "light") as GenerationModelSpec;

class FakeModel implements LanguageModelPort {
  readonly id = "fake";
  readonly label = "Fake";
  calls = 0;

  constructor(private readonly answer: string) {}

  generate(request: GenerationRequest): Promise<GenerationResult> {
    return this.stream(request, () => {});
  }

  async stream(_request: GenerationRequest, onDelta: (delta: string) => void): Promise<GenerationResult> {
    this.calls += 1;
    onDelta(this.answer);

    return {
      text: this.answer,
      finish: "stop",
      usage: { promptTokens: 900, completionTokens: 40 },
      timings: { ttftMs: 120, totalMs: 500, tokensPerSecond: 80 },
    };
  }
}

const BROWSER = describeBrowser({
  navigator: { userAgent: "Mozilla/5.0 Chrome/141.0.0.0", hardwareConcurrency: 12, deviceMemory: 8 },
  adapterInfo: { vendor: "amd", architecture: "", description: "AMD Radeon 780M" },
  usedHeapBytes: 512 * 1024 * 1024,
});

describe("the browser environment block", () => {
  it("records what the platform reports and omits what it does not", () => {
    expect(BROWSER).toEqual({
      userAgent: "Mozilla/5.0 Chrome/141.0.0.0",
      // The empty architecture is dropped rather than stored as "": a field
      // that is present and blank reads as measured.
      adapter: { vendor: "amd", description: "AMD Radeon 780M" },
      deviceClass: { cores: 12, memoryGb: 8 },
      peakMemoryMb: 512,
    });
  });

  it("leaves the optional blocks out entirely on a browser that exposes nothing", () => {
    const bare = describeBrowser({ navigator: { userAgent: "Firefox" }, adapterInfo: null, usedHeapBytes: null });

    expect(bare).toEqual({ userAgent: "Firefox" });
    expect("adapter" in bare).toBe(false);
    expect("peakMemoryMb" in bare).toBe(false);
  });
});

describe("the browser run manifest", () => {
  it("is its own configuration, never one of the headless letters", () => {
    const manifest = browserManifest({
      model: LIGHT,
      browser: BROWSER,
      knowledge: {
        contentHash: "abc123",
        embedding: { model: "e5" },
        counts: { chunks: 10, symbols: 20 },
      } as KnowledgeEngine["manifest"],
      cases: 3,
      at: new Date("2026-08-30T21:18:00Z"),
    });

    expect(manifest.config).toBe("light");
    expect(["A", "B", "C"]).not.toContain(manifest.config);
    expect(manifest.runId).toBe(`2026-08-30T2118-light-${LIGHT.id}`);
    expect(manifest.runtime).toEqual({ provider: "transformers.js", device: "webgpu" });
    expect(manifest.browser).toBe(BROWSER);

    // The versions the report compares against come from one module, so a
    // browser run and a headless one cannot claim the same prompt while
    // running different ones.
    expect(manifest.promptVersion).toBe(PROMPT_VERSION);
    expect(manifest.contextVersion).toBe(CONTEXT_VERSION);
    expect(manifest.datasetVersion).toBe(DATASET_VERSION);
  });
});

describe("a run bundle", () => {
  const artifacts: RunArtifacts = {
    manifest: browserManifest({
      model: LIGHT,
      browser: BROWSER,
      knowledge: {
        contentHash: "abc123",
        embedding: { model: "e5" },
        counts: { chunks: 10, symbols: 20 },
      } as KnowledgeEngine["manifest"],
      cases: 1,
    }),
    cases: [{ question: "q", category: "concept", locale: "en", expected: {} }],
    contexts: [],
    responses: [{ question: "q", answer: "a", latencyMs: 10, tokensPerSecond: 1 }],
  };

  it("survives the round trip through a download folder", () => {
    const whole = { ...artifacts, contexts: [{ question: "q" }] } as unknown as RunArtifacts;
    expect(parseBundle(JSON.stringify(packBundle(whole)))).toEqual(whole);
  });

  it("refuses a bundle whose streams disagree", () => {
    expect(() => parseBundle(JSON.stringify(packBundle(artifacts)))).toThrow(/streams disagree/);
  });

  it("refuses a manifest that outlived its rows", () => {
    const truncated = {
      ...artifacts,
      manifest: { ...artifacts.manifest, cases: 30 },
      contexts: [{ question: "q" }],
    } as unknown as RunArtifacts;

    expect(() => parseBundle(JSON.stringify(packBundle(truncated)))).toThrow(/claims 30 cases/);
  });

  it("refuses anything that is not a run", () => {
    expect(() => parseBundle("{}")).toThrow(/kind/);
    expect(() => parseBundle("not json")).toThrow(/not JSON/);
  });
});

describe("running the case set", () => {
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
        lexical: result.lexical,
      })
    );

    contextService = new ContextService({
      knowledge: engine.knowledge,
      routes: engine.routes,
      symbols: engine.symbols,
    });
  }, 120_000);

  const cases = generationCases().slice(0, 3);

  it("produces the same three streams a headless run writes", async () => {
    const run = await runBrowserBenchmark({
      engine,
      contextService,
      model: new FakeModel("`JIT.object` validates a shape [1]."),
      spec: LIGHT,
      browser: BROWSER,
      cases,
    });

    expect(run.artifacts.cases).toHaveLength(cases.length);
    expect(run.artifacts.contexts).toHaveLength(cases.length);
    expect(run.artifacts.responses).toHaveLength(cases.length);
    expect(run.artifacts.manifest.cases).toBe(cases.length);

    // The evidence travels with the answer, so a re-score six weeks later
    // checks a claim against the passage the model actually saw.
    expect(run.artifacts.contexts[0]?.context.evidence.length ?? 0).toBeGreaterThan(0);
    expect(run.artifacts.responses[0]?.ttftMs).toBe(120);
    expect(run.artifacts.responses[0]?.promptTokens).toBe(900);

    // And it imports: the bundle a browser downloads is a valid run.
    expect(parseBundle(JSON.stringify(packBundle(run.artifacts)))).toEqual(run.artifacts);
  });

  it("leaves a shorter run rather than a broken one when it is stopped", async () => {
    const controller = new AbortController();

    const run = await runBrowserBenchmark({
      engine,
      contextService,
      model: new FakeModel("stopped"),
      spec: LIGHT,
      browser: BROWSER,
      cases,
      signal: controller.signal,
      onProgress: (progress) => {
        if (progress.measured) controller.abort();
      },
    });

    expect(run.artifacts.responses).toHaveLength(1);
    expect(run.artifacts.manifest.cases).toBe(1);
    expect(() => parseBundle(JSON.stringify(packBundle(run.artifacts)))).not.toThrow();
  });
});

describe("the report", () => {
  const sectionFor = (ttftMs: number | undefined, manifest?: RunArtifacts["manifest"]) => {
    const measured = [
      {
        case: { question: "q", category: "concept" as const, locale: "en" as const, expected: {} },
        measurement: {
          answered: true,
          audit: {
            findings: [],
            classification: { kinds: [], origins: [] },
            grounding: {
              claims: 1,
              supported: 1,
              coverage: 1,
              fatalUnsupported: 0,
              verdict: "fully-grounded" as const,
            },
            confidence: { retrieval: 1, grounding: 1, symbols: 1 },
          },
          wrongNavigation: [],
          offeredNavigation: false,
          showedCode: false,
          citesSource: false,
          namesExpectedSymbol: null,
          attribution: {
            knowledgeIds: [],
            chunkIds: [],
            symbolIds: [],
            routeIds: [],
            contextTokens: 0,
            retrievalReasons: [],
          },
          characters: 10,
        },
        latencyMs: 2000,
        tokensPerSecond: 40,
        ...(ttftMs ? { ttftMs } : {}),
      },
    ];

    return {
      config: "light",
      label: "browser",
      ...(manifest ? { manifest } : {}),
      cases: measured,
      metrics: measureGeneration(measured),
    };
  };

  it("prints a first-token time where one was observed and a dash where it was not", () => {
    const browser = renderReport([sectionFor(400)], { title: "browser", cases: 1 });
    const headless = renderReport([sectionFor(undefined)], { title: "headless", cases: 1 });

    expect(browser).toContain("median first token");
    expect(browser).toMatch(/median first token\s+0\.40s/);
    // A zero here would read as instant. The honest value for a runtime that
    // cannot see it is nothing at all.
    expect(headless).toMatch(/median first token\s+-/);
  });

  it("shows the machine only for a run that recorded one", () => {
    const manifest = browserManifest({
      model: LIGHT,
      browser: BROWSER,
      knowledge: {
        contentHash: "abc123",
        embedding: { model: "e5" },
        counts: { chunks: 1, symbols: 1 },
      } as KnowledgeEngine["manifest"],
      cases: 1,
    });

    // Whole, not truncated into a column: a device is the reason a latency
    // number means anything.
    expect(renderReport([sectionFor(400, manifest)], { title: "browser", cases: 1 })).toContain(
      "AMD Radeon 780M · 12 cores · 8 GB · Mozilla/5.0 Chrome/141.0.0.0"
    );
    expect(renderReport([sectionFor(400)], { title: "headless", cases: 1 })).not.toContain("machine");
  });
});
