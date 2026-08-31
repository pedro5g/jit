/**
 * Running the eval set against the real retrieval stack.
 *
 * No model, no browser, no network. §93's first tier — question in, expected
 * symbol and route out — is the tier that catches almost everything, and it is
 * the one that can run on every commit because it costs a second.
 */

import { ContextService } from "../application/context/context.service";
import { promptOverhead } from "../application/context/render";
import { CONTEXT_BUDGET, RETRIEVAL_LIMIT } from "../config/retrieval";
import type { RetrievalReport } from "../core/entities/retrieval";
import type { EmbeddingPort } from "../core/ports/embedding";
import type { RouteId, SymbolId } from "../core/value-objects/ids";
import type { KnowledgeEngine } from "../infrastructure/knowledge-engine";
import { HAND_WRITTEN_CASES } from "./cases";
import { type ContextMetrics, type ContextOutcome, measureContext, scoreContext } from "./context-metrics";
import { derivedCases, derivedSymbolCases } from "./derived";
import { type CaseOutcome, type EvalCase, type EvalMetrics, measure } from "./types";

export function allCases(engine: KnowledgeEngine): EvalCase[] {
  return [...HAND_WRITTEN_CASES, ...derivedCases(engine.symbols.all()), ...derivedSymbolCases(engine.symbols.all())];
}

/** Questions about a version, where the history pages compete on equal terms. */
function wantsHistory(question: string): boolean {
  return /\b(2\.0|v2|1\.x|changed|changelog|migrat|migro|migrar|vers[ãa]o|version|novidades|what's new)\b/i.test(
    question
  );
}

export async function runCase(
  engine: KnowledgeEngine,
  testCase: EvalCase,
  embedder: EmbeddingPort | null
): Promise<{ outcome: CaseOutcome; report: RetrievalReport }> {
  const queryVector = embedder ? await embedder.embed(testCase.question) : null;

  const report = await engine.retriever.retrieve(testCase.question, {
    context: { locale: testCase.locale, ...(testCase.context ?? {}) },
    queryVector,
    limit: RETRIEVAL_LIMIT,
    allowHistory: wantsHistory(testCase.question),
  });

  const routes = report.results.map((result) => result.chunk.routeId);
  const symbols = report.exactSymbols.map((symbol) => symbol.id);

  const expectedRoutes = testCase.expected.routes ?? [];
  const expectedSymbols = testCase.expected.symbols ?? [];

  // Rank of the first acceptable route, deduplicated: two chunks from the same
  // page are one hit, not two, and counting them twice would make a retriever
  // that returns one page eight times look excellent.
  const distinctRoutes: RouteId[] = [];
  for (const routeId of routes) if (!distinctRoutes.includes(routeId)) distinctRoutes.push(routeId);

  const firstHit = distinctRoutes.findIndex((routeId) => expectedRoutes.includes(routeId)) + 1;

  return {
    report,
    outcome: {
      case: testCase,
      routes: distinctRoutes,
      symbols: symbols as SymbolId[],
      firstHit,
      bestCorrect: !testCase.expected.best || distinctRoutes[0] === testCase.expected.best,
      symbolsCorrect: expectedSymbols.every((expected) => symbols.includes(expected)),
      forbiddenHits: (testCase.forbidden ?? []).filter((routeId) => distinctRoutes.slice(0, 3).includes(routeId)),
      topScore: report.results[0]?.finalScore ?? 0,
      mode: report.mode,
      semanticMargin: report.semantic.margin,
    },
  };
}

export interface EvalRun {
  metrics: EvalMetrics;
  outcomes: CaseOutcome[];
  /** Context selection quality, measured separately from retrieval. */
  context: ContextMetrics;
  contextOutcomes: ContextOutcome[];
  /** Cases that should have found nothing and did, or the reverse. */
  evidenceMistakes: CaseOutcome[];
}

export async function runEval(
  engine: KnowledgeEngine,
  embedder: EmbeddingPort | null,
  cases = allCases(engine)
): Promise<EvalRun> {
  const outcomes: CaseOutcome[] = [];
  const contextOutcomes: ContextOutcome[] = [];

  const contextService = new ContextService({
    knowledge: engine.knowledge,
    routes: engine.routes,
    symbols: engine.symbols,
  });

  for (const testCase of cases) {
    const { outcome, report } = await runCase(engine, testCase, embedder);
    outcomes.push(outcome);

    // The same context the model would be handed, built with no model
    // involved — which is what makes selection quality measurable at all.
    const context = contextService.build({
      question: testCase.question,
      locale: testCase.locale,
      report,
      budget: CONTEXT_BUDGET.hard,
      reservedTokens: promptOverhead(engine.symbols, {
        question: testCase.question,
        exactSymbols: report.exactSymbols,
      }),
      ...(testCase.context?.routeId ? { current: { routeId: testCase.context.routeId } } : {}),
    });

    contextOutcomes.push(
      scoreContext(testCase, report, context, (chunkId) => engine.chunks.findById(chunkId as never)?.symbols ?? [])
    );
  }

  return {
    metrics: measure(outcomes),
    outcomes,
    context: measureContext(contextOutcomes),
    contextOutcomes,
    evidenceMistakes: outcomes.filter(
      (outcome, index) => (outcome.case.expectsNoEvidence ?? false) !== !contextOutcomes[index]?.hasEvidence
    ),
  };
}
