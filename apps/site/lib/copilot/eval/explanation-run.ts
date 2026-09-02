import { ContextService } from "../application/context/context.service";
import { promptOverhead } from "../application/context/render";
import { CoveragePlanner } from "../application/coverage/coverage-planner";
import { KnowledgeExpansionService } from "../application/coverage/knowledge-expansion.service";
import { CONTEXT_BUDGET } from "../config/retrieval";
import type { EmbeddingPort } from "../core/ports/embedding";
import type { ChunkId } from "../core/value-objects/ids";
import type { KnowledgeEngine } from "../infrastructure/knowledge-engine";
import { scoreContext } from "./context-metrics";
import { explanationCases, resolveExplanationFacets } from "./explanation-cases";

export interface ExplanationRetrievalMetrics {
  cases: number;
  graphNodes: number;
  graphEdges: number;
  graphBySource: Record<string, number>;
  graphByKind: Record<string, number>;
  seedFacetCoverage: number;
  expandedFacetCoverage: number;
  expansionCandidateFacetCoverage: number;
  seedContamination: number;
  expandedContamination: number;
  averageExpansionMs: number;
  averageContextTokens: number;
  p95ContextTokens: number;
  readyToGenerate: number;
  averageQueryEmbeddingMs: number;
  averageVectorScanMs: number;
  averageVectorTopKMs: number;
}

/** Deterministic before/after measurement; generation is measured by the browser runner. */
export async function runExplanationEval(
  engine: KnowledgeEngine,
  embedder: EmbeddingPort | null
): Promise<ExplanationRetrievalMetrics> {
  const cases = resolveExplanationFacets(explanationCases(), engine.knowledge, engine.graph);
  const expansionService = new KnowledgeExpansionService({
    graph: engine.graph,
    knowledge: engine.knowledge,
    chunks: engine.chunks,
  });
  const planner = new CoveragePlanner({ knowledge: engine.knowledge, chunks: engine.chunks });
  const contextService = new ContextService({
    knowledge: engine.knowledge,
    routes: engine.routes,
    symbols: engine.symbols,
  });
  let seedCoverage = 0;
  let expandedCoverage = 0;
  let candidateCoverage = 0;
  let seedContamination = 0;
  let expandedContamination = 0;
  let expansionMs = 0;
  let ready = 0;
  const contextTokens: number[] = [];
  let queryEmbeddingMs = 0;
  let vectorScanMs = 0;
  let vectorTopKMs = 0;

  for (const testCase of cases) {
    const embeddingStart = performance.now();
    const queryVector = embedder ? await embedder.embed(testCase.question) : null;
    queryEmbeddingMs += embedder ? performance.now() - embeddingStart : 0;
    const report = await engine.retriever.retrieve(testCase.question, {
      context: { locale: testCase.locale },
      queryVector,
    });
    vectorScanMs += report.timings.vector?.vectorScanMs ?? 0;
    vectorTopKMs += report.timings.vector?.topKSelectionMs ?? 0;
    const emptyExpansion = { seeds: [], candidates: [], visited: 0, elapsedMs: 0 };
    const seedPlan = planner.plan({ question: testCase.question, report, expansion: emptyExpansion });
    const expansion = expansionService.expand({
      question: testCase.question,
      seeds: report.results.slice(0, 5),
      locale: testCase.locale,
      maxDepth: 2,
      maxCandidates: 30,
    });
    const plan = planner.plan({ question: testCase.question, report, expansion });
    const expected = new Set(testCase.expected.facets ?? []);
    seedCoverage += facetRecall(expected, new Set(seedPlan.selectedFacetIds));
    expandedCoverage += facetRecall(expected, new Set(plan.selectedFacetIds));
    const candidateFacets = new Set(
      expansion.candidates.flatMap(
        (candidate) => engine.knowledge.findById(candidate.knowledgeId)?.facets.map((facet) => facet.id) ?? []
      )
    );
    candidateCoverage += facetRecall(expected, candidateFacets);
    expansionMs += expansion.elapsedMs;
    if (plan.readiness.sufficient) ready += 1;

    const contextInput = {
      question: testCase.question,
      locale: testCase.locale,
      report,
      budget: CONTEXT_BUDGET.hard,
      reservedTokens: promptOverhead(engine.symbols, {
        question: testCase.question,
        exactSymbols: report.exactSymbols,
        answerMode: plan.answerMode,
      }),
    } as const;
    const seedContext = contextService.build({ ...contextInput, plan: seedPlan });
    const context = contextService.build({ ...contextInput, plan });
    const symbolsOf = (chunkId: string) => engine.chunks.findById(chunkId as ChunkId)?.symbols ?? [];
    seedContamination += Number(scoreContext(testCase, report, seedContext, symbolsOf).contaminants.length > 0);
    expandedContamination += Number(scoreContext(testCase, report, context, symbolsOf).contaminants.length > 0);
    contextTokens.push(context.budget.evidenceUsed + context.budget.reserved);
  }

  const count = cases.length || 1;
  contextTokens.sort((left, right) => left - right);
  return {
    cases: cases.length,
    graphNodes: engine.knowledge.all().length,
    graphEdges: engine.graph.all().length,
    graphBySource: countBy(engine.graph.all(), (edge) => edge.source),
    graphByKind: countBy(engine.graph.all(), (edge) => edge.kind),
    seedFacetCoverage: seedCoverage / count,
    expandedFacetCoverage: expandedCoverage / count,
    expansionCandidateFacetCoverage: candidateCoverage / count,
    seedContamination: seedContamination / count,
    expandedContamination: expandedContamination / count,
    averageExpansionMs: expansionMs / count,
    averageContextTokens: contextTokens.reduce((sum, value) => sum + value, 0) / count,
    p95ContextTokens: contextTokens[Math.min(contextTokens.length - 1, Math.floor(contextTokens.length * 0.95))] ?? 0,
    readyToGenerate: ready / count,
    averageQueryEmbeddingMs: queryEmbeddingMs / count,
    averageVectorScanMs: vectorScanMs / count,
    averageVectorTopKMs: vectorTopKMs / count,
  };
}

function countBy<T>(values: readonly T[], key: (value: T) => string): Record<string, number> {
  const result: Record<string, number> = {};
  for (const value of values) {
    const name = key(value);
    result[name] = (result[name] ?? 0) + 1;
  }
  return result;
}

function facetRecall(expected: ReadonlySet<string>, actual: ReadonlySet<string>): number {
  if (expected.size === 0) return 1;
  let found = 0;
  for (const facet of expected) if (actual.has(facet)) found += 1;
  return found / expected.size;
}
