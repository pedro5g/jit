import { beforeAll, describe, expect, it } from "vitest";
import { build } from "../../../scripts/knowledge/build";
import { ContextService } from "../application/context/context.service";
import { promptOverhead, renderMessages } from "../application/context/render";
import { classify, dedupe, selectByRole } from "../application/context/stages";
import { estimateTokens, fitToBudget } from "../application/context/token-budget";
import { CONTEXT_BUDGET, MIN_EVIDENCE_CONFIDENCE } from "../config/retrieval";
import type { ModelContext } from "../core/entities/model-context";
import { createKnowledgeEngine, type KnowledgeEngine } from "../infrastructure/knowledge-engine";
import { MemoryArtifactLoader } from "../infrastructure/storage/memory-artifact-loader";

/**
 * The context, tested with no model anywhere near it.
 *
 * That is the property worth protecting: selection is deterministic, so what
 * the model would have been shown is knowable, assertable and diffable without
 * loading a gigabyte of weights. Every failure below would otherwise present
 * as "the answer was a bit off" and be diagnosed by reading tea leaves.
 */
describe("context selection", () => {
  let engine: KnowledgeEngine;
  let service: ContextService;

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

    service = new ContextService({
      knowledge: engine.knowledge,
      routes: engine.routes,
      symbols: engine.symbols,
    });
  }, 120_000);

  async function contextFor(question: string, locale: "en" | "pt-BR" = "en"): Promise<ModelContext> {
    const report = await engine.retriever.retrieve(question, { context: { locale } });
    return service.build({
      question,
      locale,
      report,
      budget: CONTEXT_BUDGET.hard,
      reservedTokens: promptOverhead(engine.symbols, { question, exactSymbols: report.exactSymbols }),
    });
  }

  it("carries the uuid symbol and no release notes for a Portuguese uuid question", async () => {
    const context = await contextFor("como validar um uuid?", "pt-BR");

    expect(context.symbols.map((entry) => entry.symbol.id)).toContain("symbol.jit.string.uuid");
    expect(context.evidence.map((evidence) => evidence.routeId)).not.toContain("route.docs.whats-new");
    expect(context.evidence.map((evidence) => evidence.routeId)).not.toContain("route.docs.guides.migrating-to-2");
    expect(context.evidence.length).toBeLessThanOrEqual(6);
    expect(context.budget.evidenceUsed).toBeLessThanOrEqual(context.budget.evidenceAllowance);
  });

  it("keeps an exact symbol match when the question is only a name", async () => {
    // The plan's own example named `JIT.class.identity`, which the library does
    // not have — the real identity factory is `JIT.ddd.uniqueIdentifier`. The
    // index is what settles that, which is the whole argument for having one.
    const context = await contextFor("JIT.ddd.uniqueIdentifier");

    expect(context.symbols.map((entry) => entry.symbol.id)).toContain("symbol.jit.ddd.uniqueIdentifier");
    // The symbol's own reference page leads, rather than whatever the semantic
    // retriever thought was nearby.
    expect(context.evidence[0]?.routeId).toBe("route.docs.reference.functions.runtime-classes");
  });

  it("states the schema kinds a chain method is allowed on", async () => {
    const context = await contextFor("what does JIT.string().uuid() do?");
    const uuid = context.symbols.find((entry) => entry.symbol.name === "uuid");

    // Reflection cannot supply this: every builder shares one prototype, so
    // `.uuid()` is a function on a number at runtime and a type error in an
    // editor.
    expect(uuid?.validOn).toContain("string");
  });

  it("balances roles rather than letting one kind fill the context", async () => {
    const context = await contextFor("why is jit fast?");
    const counts = new Map<string, number>();
    for (const evidence of context.evidence) counts.set(evidence.role, (counts.get(evidence.role) ?? 0) + 1);

    for (const [role, count] of counts) {
      expect(count, `${role} took ${count} slots`).toBeLessThanOrEqual(3);
    }
  });

  it("drops evidence worth a fraction of the best hit", async () => {
    const context = await contextFor("how do I generate code ahead of time?");

    for (const evidence of context.evidence.slice(1)) {
      expect(evidence.confidence).toBeGreaterThanOrEqual(MIN_EVIDENCE_CONFIDENCE);
    }
  });

  it("keeps the prompt inside the budget it was given", async () => {
    for (const question of [
      "como criar uma entidade com uuid automático?",
      "how do I use JIT.security.mask?",
      "what is a DTO in jit?",
    ]) {
      const context = await contextFor(question);
      const messages = renderMessages(context, { symbols: engine.symbols });
      const tokens = estimateTokens(messages.map((message) => message.content).join("\n"));

      expect(tokens, `${question} rendered ${tokens} tokens`).toBeLessThanOrEqual(CONTEXT_BUDGET.hard);
    }
  }, 60_000);

  it("records why every passage is there and where it came from", async () => {
    // §PART 3: never hand the model a string without knowing its provenance.
    const context = await contextFor("how do I mask a field?");

    for (const evidence of context.evidence) {
      expect(evidence.knowledgeId).toMatch(/^knowledge\./);
      expect(evidence.chunkId).toMatch(/^chunk\./);
      expect(evidence.routeId).toMatch(/^route\./);
      expect(evidence.reason).toBeTruthy();
      expect(evidence.confidence).toBeGreaterThan(0);
      expect(evidence.tokens).toBeGreaterThan(0);
    }
  });

  it("accounts for everything it dropped", async () => {
    const question = "how does jit compile schemas?";
    const report = await engine.retriever.retrieve(question, { context: { locale: "en" } });
    const context = await contextFor(question);

    const { budget } = context;
    expect(context.evidence.length + budget.droppedAsRedundant + budget.droppedForBudget).toBe(report.results.length);
  });

  it("treats the current page as a signal and not as an authority", async () => {
    const question = "how do I validate a uuid?";
    const report = await engine.retriever.retrieve(question, {
      context: { locale: "en", routeId: "route.docs.reference.functions.csv" as never },
    });

    const context = service.build({
      question,
      locale: "en",
      report,
      current: { routeId: "route.docs.reference.functions.csv" as never },
    });

    // Standing on the CSV page must not make CSV the answer to a uuid question.
    expect(context.evidence[0]?.routeId).not.toBe("route.docs.reference.functions.csv");
  });
});

describe("context stages", () => {
  it("classifies by what a passage is for, not by what it says", () => {
    const chunk = (kind: string, reason: string) =>
      ({ chunk: { id: "chunk.x", kind }, reason }) as never as Parameters<typeof classify>[0];

    expect(classify(chunk("reference", "lexical"))).toBe("reference");
    expect(classify(chunk("migration", "lexical"))).toBe("history");
    expect(classify(chunk("concept", "lexical"))).toBe("concept");
    // Retrieved because the reader named the API it documents: a different
    // role from the same passage found by word overlap.
    expect(classify(chunk("reference", "exact-symbol"))).toBe("symbol");
    expect(classify(chunk("reference", "current-context"))).toBe("current-context");
  });

  it("drops a second slice of the same entry", () => {
    const results = [
      { chunk: { id: "a", knowledgeId: "k1", content: "alpha beta gamma delta epsilon" } },
      { chunk: { id: "b", knowledgeId: "k1", content: "totally different words entirely here" } },
      { chunk: { id: "c", knowledgeId: "k2", content: "zeta eta theta iota kappa lambda" } },
    ] as never as Parameters<typeof dedupe>[0];

    const report = dedupe(results);
    expect(report.kept).toHaveLength(2);
    expect(report.dropped).toBe(1);
  });

  it("caps a role at its quota, keeping the best of it", () => {
    const results = Array.from({ length: 6 }, (_, index) => ({ chunk: { id: `c${index}` } })) as never as Parameters<
      typeof selectByRole
    >[0];

    const { kept, dropped } = selectByRole(results, () => "concept");
    expect(kept).toHaveLength(3);
    expect(dropped).toBe(3);
    // Rank order is preserved: a quota is a ceiling, not a resampling.
    expect((kept[0] as { chunk: { id: string } }).chunk.id).toBe("c0");
  });
});

describe("token budget", () => {
  it("charges code more than prose per character", () => {
    const prose = "a".repeat(400);
    const code = `\`\`\`ts\n${"a".repeat(392)}\n\`\`\``;

    expect(estimateTokens(code)).toBeGreaterThan(estimateTokens(prose));
  });

  it("keeps the first item even when it does not fit", () => {
    const kept = fitToBudget([100, 100, 100], (size) => size, 10);
    expect(kept).toEqual([100]);
  });

  it("skips an item that would overflow and keeps looking", () => {
    const kept = fitToBudget([5, 100, 4], (size) => size, 10);
    expect(kept).toEqual([5, 4]);
  });
});
