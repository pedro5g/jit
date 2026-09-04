import { describe, expect, it } from "vitest";
import { analyseClaims } from "../application/audit/claims.js";
import type { ModelContext } from "../core/entities/model-context.js";

function contextWith(...contents: string[]): ModelContext {
  return {
    question: "why is jit fast?",
    locale: "en",
    scope: "broad",
    answerMode: "explain",
    evidence: contents.map((content, index) => ({
      knowledgeId: "docs.why-jit" as never,
      chunkId: `chunk-${index}` as never,
      routeId: "route.docs.concepts.why-jit" as never,
      index: index + 1,
      breadcrumb: "Concepts / Why JIT",
      title: "Why JIT",
      content,
      role: "concept" as const,
      reason: "oracle" as const,
      confidence: 1,
      showsRemovedApis: false,
      tokens: content.split(/\s+/).length,
      facets: [],
      section: "core",
    })),
    symbols: [],
    corrections: [],
    navigation: [],
    budget: {
      total: 1600,
      reserved: 0,
      evidenceAllowance: 1600,
      evidenceUsed: 20,
      droppedForBudget: 0,
      droppedAsRedundant: 0,
    },
    coverage: {
      coverageScore: 1,
      selectedFacetIds: [],
      readiness: { sufficient: true, coverage: 1, evidenceCount: contents.length, sourceConfidence: 1 },
    },
    empty: contents.length === 0,
  };
}

function claims(answer: string, context = contextWith("The JIT compiles schemas into specialized operations.")) {
  return analyseClaims({
    answer,
    context,
    hasSymbol: () => false,
    corpusKnows: () => false,
  }).claims;
}

describe("grounding detector calibration", () => {
  it("keeps all passages when chunks share one knowledge id", () => {
    const result = claims(
      "The JIT compiles schemas into specialized operations.",
      contextWith(
        "The JIT compiles schemas into specialized operations.",
        "The generated code uses direct property access and avoids generic work."
      )
    );

    expect(result).toHaveLength(1);
    expect(result[0]?.supported).toBe(true);
    expect(result[0]?.evidenceIds).toContain("docs.why-jit");
  });

  it("accepts a clear paraphrase of the verified mechanism", () => {
    const result = claims(
      "The compiler specializes schemas into generated operations, so repeated calls use direct property access.",
      contextWith(
        "The compiler specializes schemas into generated operations. Repeated calls use direct property access."
      )
    );

    expect(result).toHaveLength(1);
    expect(result[0]?.supported).toBe(true);
  });

  it("keeps mixed truth and invention unsupported", () => {
    const result = claims(
      "The JIT compiles schemas into specialized operations, and it always runs in constant time regardless of input size."
    );

    expect(result).toHaveLength(1);
    expect(result[0]?.supported).toBe(false);
  });

  it("rejects invented history and entities", () => {
    const result = claims("The JIT was created by Ada Lovelace in 1843 for browser validation.");

    expect(result.map((claim) => claim.kind)).toEqual(expect.arrayContaining(["historical", "entity"]));
    expect(result.every((claim) => claim.supported === false)).toBe(true);
  });
});
