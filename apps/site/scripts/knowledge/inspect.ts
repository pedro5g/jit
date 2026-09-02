/**
 * `pnpm knowledge:inspect "como validar uuid"`.
 *
 * §88 calls this fundamental, and it is: every tuning decision in retrieval is
 * otherwise made by reading an answer and forming an impression. This prints
 * what each retriever returned, what the fusion did with it, and what the
 * model would actually have been shown — so "that felt better" becomes "the
 * semantic retriever ranked it 7th and the lexical one missed it".
 */
import path from "node:path";
import { ContextService } from "../../lib/copilot/application/context/context.service";
import { promptOverhead, renderedSize, renderMessages } from "../../lib/copilot/application/context/render";
import { CoveragePlanner } from "../../lib/copilot/application/coverage/coverage-planner";
import { KnowledgeExpansionService } from "../../lib/copilot/application/coverage/knowledge-expansion.service";
import { ARTIFACT_DIR } from "../../lib/copilot/config/artifacts";
import { CONTEXT_BUDGET, MIN_USABLE_SCORE } from "../../lib/copilot/config/retrieval";
import { routeIdForPath } from "../../lib/copilot/config/routes";
import type { RetrievalSignal } from "../../lib/copilot/core/entities/retrieval";
import { detectLocale } from "../../lib/copilot/core/value-objects/locale";
import { createKnowledgeEngine } from "../../lib/copilot/infrastructure/knowledge-engine";
import { NodeArtifactLoader } from "../../lib/copilot/infrastructure/storage/node-artifact-loader";
import { TransformersEmbedder } from "./embeddings/embed";

/** Terminal styling, kept out of the strings so the file has no control bytes. */
const BOLD = "\u001b[1m";
const RESET = "\u001b[0m";
const YELLOW = "\u001b[33m";

export async function inspect(
  question: string,
  options: { currentPath?: string; noEmbed?: boolean; showPrompt?: boolean }
): Promise<void> {
  const siteDir = path.resolve(import.meta.dirname, "../..");
  const loader = new NodeArtifactLoader(path.join(siteDir, "public", ARTIFACT_DIR));
  const engine = await createKnowledgeEngine(loader);

  const locale = detectLocale(question);
  const routeId = options.currentPath ? routeIdForPath(options.currentPath) : null;

  let queryVector: Float32Array | null = null;
  let queryEmbeddingMs = 0;
  if (engine.hasSemanticSearch && !options.noEmbed) {
    const embeddingStart = performance.now();
    queryVector = await new TransformersEmbedder().embed(question);
    queryEmbeddingMs = performance.now() - embeddingStart;
  }

  const started = performance.now();
  const report = await engine.retriever.retrieve(question, {
    context: { locale, ...(routeId ? { routeId } : {}) },
    queryVector,
  });
  const elapsed = performance.now() - started;
  report.timings.queryEmbeddingMs = queryEmbeddingMs;
  report.timings.totalSemanticMs = queryEmbeddingMs + report.timings.semanticMs;

  const line = (label: string, value: string) => console.log(`${label.padEnd(22)}${value}`);

  console.log(`\n${BOLD}${question}${RESET}`);
  line("locale", locale);
  line("normalized", report.normalizedQuery || "(nothing survived tokenization)");
  if (routeId) line("current page", routeId);
  line("semantic", queryVector ? "on" : engine.hasSemanticSearch ? "skipped (--no-embed)" : "no vectors in artifacts");

  console.log(`\n${BOLD}exact symbols${RESET}`);
  if (report.exactSymbols.length === 0) console.log("  (none — the question named no API)");
  for (const symbol of report.exactSymbols) {
    console.log(`  ${symbol.path.padEnd(38)} ${symbol.kind.padEnd(10)} ${symbol.routeId ?? "(undocumented)"}`);
  }

  const signals: RetrievalSignal[] = ["exact-symbol", "prefix-symbol", "lexical", "semantic", "current-context"];
  for (const signal of signals) {
    const candidates = report.bySignal[signal];
    if (candidates.length === 0) continue;

    console.log(`\n${BOLD}${signal}${RESET} (top 10 of ${candidates.length})`);
    for (const candidate of candidates.slice(0, 10)) {
      const chunk = engine.chunks.findById(candidate.chunkId);
      console.log(
        `  ${String(candidate.rank).padStart(2)}. ${candidate.score.toFixed(4)}  ${chunk?.breadcrumb ?? candidate.chunkId}`
      );
    }
  }

  const { semantic } = report;
  if (semantic.top.length > 0) {
    console.log(`\n${BOLD}semantic separation${RESET}`);
    line("top scores", semantic.top.map((score) => score.toFixed(4)).join("  "));
    line(
      "margin",
      `${semantic.margin.toFixed(4)} (top1 - top2)${semantic.margin < 0.005 ? "  — effectively a tie" : ""}`
    );
    line("spread", `${semantic.spread.toFixed(4)} (top1 - top3)`);
  }

  console.log(`\n${BOLD}fused${RESET}  mode: ${report.mode}`);
  for (const [index, result] of report.results.entries()) {
    const parts = Object.entries(result.scores)
      .map(([name, value]) => `${name}=${value.toFixed(3)}`)
      .join(" ");

    console.log(
      `  ${String(index + 1).padStart(2)}. ${result.finalScore.toFixed(5)}  [${result.reason}] ${result.chunk.breadcrumb}`
    );
    console.log(`      ${result.chunk.routeId}${result.chunk.anchor ? `#${result.chunk.anchor}` : ""}  ${parts}`);
  }

  const expansion = new KnowledgeExpansionService({
    graph: engine.graph,
    knowledge: engine.knowledge,
    chunks: engine.chunks,
  }).expand({ question, seeds: report.results.slice(0, 5), locale, maxDepth: 2, maxCandidates: 30 });
  const plan = new CoveragePlanner({ knowledge: engine.knowledge, chunks: engine.chunks }).plan({
    question,
    report,
    expansion,
  });
  const knownSymbols = plan.scope === "broad" ? report.explicitSymbols : report.exactSymbols;
  const reservedTokens: number = promptOverhead(engine.symbols, {
    question,
    exactSymbols: knownSymbols,
    answerMode: plan.answerMode,
  });
  const context = new ContextService({
    knowledge: engine.knowledge,
    routes: engine.routes,
    symbols: engine.symbols,
  }).build({
    question,
    locale,
    report,
    plan,
    budget: CONTEXT_BUDGET.hard,
    reservedTokens,
    ...(routeId ? { current: { routeId } } : {}),
  });

  console.log(`\n${BOLD}coverage plan${RESET}`);
  line("question scope", plan.scope);
  line("answer mode", plan.answerMode);
  line("seeds", plan.seeds.join(", ") || "(none)");
  line("graph", `${engine.knowledge.all().length} nodes · ${engine.graph.all().length} edges`);
  const graphSources = new Map<string, number>();
  for (const edge of engine.graph.all()) graphSources.set(edge.source, (graphSources.get(edge.source) ?? 0) + 1);
  line(
    "graph sources",
    [...graphSources]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([source, count]) => `${source} ${count}`)
      .join(" · ")
  );
  console.log(
    `\n${BOLD}expanded${RESET} (${expansion.candidates.length} candidates, ${expansion.elapsedMs.toFixed(2)}ms)`
  );
  for (const candidate of expansion.candidates) {
    console.log(
      `  d${candidate.depth} ${candidate.relation.padEnd(13)} ${candidate.relevance.toFixed(3)}  ${candidate.from} -> ${candidate.knowledgeId}`
    );
  }
  console.log(`\n${BOLD}facets discovered${RESET}`);
  for (const facet of plan.facets.slice(0, 20)) {
    const selected = plan.selectedFacetIds.includes(facet.id) ? "*" : " ";
    console.log(
      ` ${selected} ${facet.importance.toFixed(3)}  ${facet.label} (${facet.source}, ${facet.candidateCount})`
    );
  }
  console.log(`\n${BOLD}candidate → facets${RESET}`);
  for (const candidate of plan.candidates.slice(0, 20)) {
    const selected = plan.selected.some((result) => result.chunk.knowledgeId === candidate.result.chunk.knowledgeId)
      ? "*"
      : " ";
    const labels = candidate.facets
      .filter((facet) => facet.source !== "kind" && facet.source !== "route")
      .map((facet) => facet.label)
      .slice(0, 6);
    console.log(` ${selected} ${candidate.result.chunk.knowledgeId} :: ${labels.join(" · ") || "(none)"}`);
  }
  line(
    "selected facets",
    plan.facets
      .filter((facet) => plan.selectedFacetIds.includes(facet.id))
      .map((facet) => facet.label)
      .join(" · ") || "(none)"
  );
  line("coverage score", plan.coverageScore.toFixed(3));
  line("readiness", `${plan.readiness.sufficient ? "generate" : "fallback"} · ${JSON.stringify(plan.readiness)}`);
  line("redundancy dropped", String(plan.redundancyDropped));
  const selectedFacetIds = new Set(plan.selectedFacetIds);
  const facetMismatch = context.evidence.filter(
    (evidence) => evidence.facets.length > 0 && !evidence.facets.some((facet) => selectedFacetIds.has(facet.id))
  ).length;
  line(
    "contamination proxy",
    `${context.evidence.length === 0 ? "0.0" : ((facetMismatch / context.evidence.length) * 100).toFixed(1)}% (facet mismatch; eval uses subject-aware contamination)`
  );

  console.log(`\n${BOLD}context${RESET}`);
  const { budget } = context;
  line("evidence", `${context.evidence.length} of ${report.results.length} results`);
  line("dropped", `${budget.droppedAsRedundant} redundant or over quota, ${budget.droppedForBudget} over budget`);
  line("documentation", `${budget.evidenceUsed} tokens of ${budget.evidenceAllowance} allowed`);
  line("fixed overhead", `${budget.reserved} tokens (rules, corrections, symbol truth, api surface)`);
  line(
    "prompt total",
    `${budget.evidenceUsed + budget.reserved} (target ${CONTEXT_BUDGET.target}, hard ${CONTEXT_BUDGET.hard})`
  );
  line("top score", `${(report.results[0]?.finalScore ?? 0).toFixed(5)} (usable above ${MIN_USABLE_SCORE})`);
  line(
    "coverage",
    report.coverage.covered
      ? `covered (specificity ${report.coverage.specificity.toFixed(2)})`
      : `not covered; unknown: ${report.coverage.unknownTerms.join(", ") || "no indexed subject"}`
  );

  for (const evidence of context.evidence) {
    console.log(
      `  [${evidence.index}] ${evidence.role.padEnd(16)} ${evidence.confidence.toFixed(2)}  ${evidence.section} -> ${evidence.breadcrumb}${evidence.showsRemovedApis ? " (quotes removed APIs)" : ""}`
    );
  }

  if (context.empty) {
    console.log(`  ${YELLOW}no usable evidence — the honest answer is that the docs do not cover this${RESET}`);
  }

  if (options.showPrompt) {
    const messages = renderMessages(context, { symbols: engine.symbols });
    console.log(
      `\n${BOLD}prompt${RESET} (${renderedSize(messages)} characters, ~${Math.round(renderedSize(messages) / 4)} tokens)`
    );
    for (const message of messages) {
      console.log(`\n${YELLOW}--- ${message.role} ---${RESET}\n${message.content}`);
    }
  }

  const { timings } = report;
  if (timings.vector) {
    line("vector corpus", `${timings.vector.vectorCount} × ${timings.vector.dimensions}`);
    line(
      "vector search",
      `scan+heap ${timings.vector.vectorScanMs.toFixed(3)}ms · finalize top-${timings.vector.limit} ${timings.vector.topKSelectionMs.toFixed(3)}ms · total ${timings.vector.totalMs.toFixed(3)}ms`
    );
    line("query embedding", `${(timings.queryEmbeddingMs ?? 0).toFixed(1)}ms`);
  }
  line(
    "timings",
    `symbol ${timings.symbolMs.toFixed(1)}ms · lexical ${timings.lexicalMs.toFixed(1)}ms · semantic ${timings.semanticMs.toFixed(1)}ms · fusion ${timings.fusionMs.toFixed(1)}ms · total ${elapsed.toFixed(1)}ms`
  );
  console.log("");
}
