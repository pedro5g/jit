import type { CoveragePlan } from "../../core/entities/coverage";
import type { RetrievalReport } from "../../core/entities/retrieval";
import type { Locale } from "../../core/value-objects/locale";
import type { KnowledgeEngine } from "../../infrastructure/knowledge-engine";
import { CoveragePlanner } from "./coverage-planner";
import { KnowledgeExpansionService } from "./knowledge-expansion.service";

/** Shared deterministic retrieval-report -> coverage-plan lowering. */
export function buildCoveragePlan(
  engine: KnowledgeEngine,
  question: string,
  report: RetrievalReport,
  locale: Locale
): CoveragePlan {
  const expansion = new KnowledgeExpansionService({
    graph: engine.graph,
    knowledge: engine.knowledge,
    chunks: engine.chunks,
  }).expand({ question, seeds: report.results.slice(0, 5), locale, maxDepth: 2, maxCandidates: 30 });
  return new CoveragePlanner({ knowledge: engine.knowledge, chunks: engine.chunks }).plan({
    question,
    report,
    expansion,
    maxEvidence: 8,
  });
}
