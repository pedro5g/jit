import { describe, expect, it } from "vitest";
import type { CapabilityReportSection } from "../eval/capability-report.js";
import {
  chooseShootoutVerdict,
  renderModelShootoutReport,
  selectDownloadableFallback,
  selectEfficiencyWinner,
} from "../eval/model-shootout-report.js";

function candidate(provider: "transformers-webgpu" | "chrome-language-model", pass: boolean, bytes?: number) {
  const metric = {
    coreFacetCoverage: pass ? 0.95 : 0.7,
    weightedExplanationCompleteness: pass ? 0.9 : 0.6,
    supportingFacetCoverage: pass ? 0.9 : 0.6,
    optionalFacetCoverage: pass ? 0.8 : 0.4,
    generation: {
      groundingCoverage: pass ? 0.97 : 0,
      substantiallyUngrounded: pass ? 0.01 : 1,
      wrongLanguage: 0,
      inventedSymbol: 0,
      fabricatedEntity: 0,
      fabricatedHistory: 0,
      usableExplanation: pass ? 0.9 : 0,
      truncated: 0,
    },
    runtime: { medianTtftMs: pass ? 100 : null, medianLatencyMs: 500, p95LatencyMs: 700, tokensPerSecond: 20 },
  } as never;
  const section = {
    config: "P",
    label: "P",
    artifacts: { manifest: { runtime: { provider, device: "browser" } } },
    cases: Array.from({ length: 40 }, () => ({ case: { question: "not a smoke question" } })),
    metrics: metric,
    deliveredMetrics: metric,
  } as unknown as CapabilityReportSection;
  return {
    candidate: {
      id: `${provider}-${pass}`,
      label: `${provider}-${pass}`,
      provider,
      parameterCount: provider === "chrome-language-model" ? undefined : 360_000_000,
      ...(bytes === undefined ? {} : { approximateBytes: bytes }),
    },
    sections: [section],
    availability: provider === "chrome-language-model" ? "available" : undefined,
  };
}

describe("model shootout selection", () => {
  it("keeps Chrome, downloadable quality and pending states distinct", () => {
    const chrome = candidate("chrome-language-model", true);
    const downloadable = candidate("transformers-webgpu", true, 100);
    expect(chooseShootoutVerdict([chrome, downloadable])).toMatch(/^VERDICT C/);
    expect(selectEfficiencyWinner([chrome, downloadable])?.candidate.provider).toBe("chrome-language-model");
    expect(selectDownloadableFallback([chrome, downloadable])?.candidate.provider).toBe("transformers-webgpu");
    expect(chooseShootoutVerdict([candidate("transformers-webgpu", false)])).toMatch(/^VERDICT D/);
    expect(chooseShootoutVerdict([candidate("chrome-language-model", false)])).toMatch(/^VERDICT D/);
  });

  it("prints an explicit unknown for opaque model parameters and unavailable metrics", () => {
    const report = renderModelShootoutReport({
      candidates: [
        {
          candidate: { id: "chrome", label: "Chrome", provider: "chrome-language-model" },
          sections: [],
        },
      ],
      benchmarkVersion: "test",
    });
    expect(report).toContain("unknown/not exposed");
    expect(report).toContain("N/A");
    expect(report).toContain("Pleasantness is not correctness");
  });
});
