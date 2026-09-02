/**
 * Retrieval in, `ModelContext` out.
 *
 * The rule this exists to enforce is §36's: the model never sees raw
 * documents. It sees a bounded, deduplicated, role-balanced, numbered set of
 * passages plus the names it is allowed to use — and every one of those
 * adjectives answers a specific failure a small model makes.
 *
 * Bounded, because a 0.8B given 4,000 tokens averages across passages instead
 * of reading the relevant one. Deduplicated, because six slices of one idea
 * spend the whole budget restating it. Role-balanced, because without quotas
 * the ranking cheerfully returns six conceptual chunks and no example.
 * Numbered, because a claim that cannot be traced to a source cannot be
 * audited.
 *
 * It produces data, not a prompt. Serialization is a later step and the only
 * model-specific one, which is what lets the selection be measured: context
 * recall and contamination are properties of this file's output, and they are
 * measurable only because the output is an object.
 */
import { CONTEXT_BUDGET, MIN_BROAD_FACET_CONFIDENCE, MIN_EVIDENCE_CONFIDENCE } from "../../config/retrieval";
import type { ApiSymbol } from "../../core/entities/api-symbol";
import type { CoveragePlan } from "../../core/entities/coverage";
import type {
  ContextEvidence,
  ContextNavigation,
  ContextSymbol,
  EvidenceRole,
  ModelContext,
} from "../../core/entities/model-context";
import type { RetrievalReport, RetrievalResult } from "../../core/entities/retrieval";
import type { KnowledgeRepository, RouteRepository, SymbolRepository } from "../../core/repositories";
import type { RouteId } from "../../core/value-objects/ids";
import type { Locale } from "../../core/value-objects/locale";
import { findCorrections } from "./corrections";
import { classify, dedupe, selectByRole } from "./stages";
import { estimateTokens } from "./token-budget";

export interface ContextServiceDeps {
  knowledge: KnowledgeRepository;
  routes: RouteRepository;
  symbols: SymbolRepository;
}

export interface ContextRequest {
  question: string;
  locale: Locale;
  report: RetrievalReport;
  plan?: CoveragePlan;

  current?: {
    routeId?: RouteId;
    anchor?: string;
    selectedText?: string;
  };

  /** What the whole prompt may cost. Defaults to §38's target. */
  budget?: number;
  /** What the fixed blocks will cost once serialized. */
  reservedTokens?: number;
}

export class ContextService {
  constructor(private readonly deps: ContextServiceDeps) {}

  build(request: ContextRequest): ModelContext {
    const plan = request.plan ?? fallbackPlan(request.report);
    const total = request.budget ?? CONTEXT_BUDGET.target;
    const reserved = request.reservedTokens ?? 0;

    /**
     * Fixed prompt blocks consume their declared share, and the remainder is
     * the hard ceiling for source evidence. A prompt that is all rules and no
     * evidence is a prompt answered from memory — which is the failure every
     * one of those rules is trying to prevent.
     */
    const evidenceAllowance = Math.max(0, total - reserved);

    // ---------------------------------------------- classify and deduplicate
    const roles = new Map<string, EvidenceRole>();
    for (const result of plan.selected) roles.set(result.chunk.id, classify(result));
    const roleOf = (result: RetrievalResult) => roles.get(result.chunk.id) ?? "reference";

    const deduped = dedupe(plan.selected);
    const selected = selectByRole(request.report.coverage.covered ? deduped.kept : [], roleOf);

    // ------------------------------------------------------- allocate budget
    const best = plan.selected[0]?.finalScore ?? request.report.results[0]?.finalScore ?? 0;
    const evidence: ContextEvidence[] = [];
    let used = 0;
    let droppedForBudget = 0;

    for (const result of selected.kept) {
      const entry = this.deps.knowledge.findById(result.chunk.knowledgeId);
      const facets = entry?.facets ?? [];
      const selectedFacet = facets.find((facet) => plan.selectedFacetIds.includes(facet.id));
      const candidate = toEvidence(
        result,
        evidence.length + 1,
        roleOf(result),
        best,
        facets,
        evidence.length === 0 ? "Core evidence" : (selectedFacet?.label ?? result.chunk.title),
        result.chunk.content
      );

      // A passage worth a fraction of the top hit is attention a small model
      // spends badly. The first one is exempt: something beats nothing.
      const broadConceptSupport =
        plan.scope === "broad" &&
        candidate.confidence >= MIN_BROAD_FACET_CONFIDENCE &&
        selectedFacet !== undefined &&
        (entry?.kind === "concept" || entry?.kind === "overview");

      if (evidence.length > 0 && candidate.confidence < MIN_EVIDENCE_CONFIDENCE && !broadConceptSupport) {
        droppedForBudget += 1;
        continue;
      }

      // The first passage is kept even when it exceeds the allowance alone: a
      // context with nothing in it is worse than a long one.
      if (evidence.length > 0 && used + candidate.tokens > evidenceAllowance) {
        droppedForBudget += 1;
        continue;
      }

      evidence.push(candidate);
      used += candidate.tokens;
    }

    // ---------------------------------------------------------- symbol truth
    const knownSymbols = plan.scope === "broad" ? request.report.explicitSymbols : request.report.exactSymbols;
    const symbols: ContextSymbol[] = knownSymbols.slice(0, 4).map((symbol) => ({
      symbol,
      validOn: symbol.validOn,
      members: this.membersOf(symbol),
      ...(symbol.routeConfidence ? { routeConfidence: symbol.routeConfidence } : {}),
    }));

    // ----------------------------------------------------------- where to go
    const navigation: ContextNavigation[] = [];
    const seenRoutes = new Set<RouteId>();

    for (const item of evidence) {
      if (seenRoutes.has(item.routeId)) continue;
      seenRoutes.add(item.routeId);

      const route = this.deps.routes.find(item.routeId);
      if (!route) continue;

      // A symbol whose page was inferred from a passing mention is a weak
      // destination. Recorded, not yet refused.
      const weak = symbols.some(
        (entry) => entry.symbol.routeId === item.routeId && entry.routeConfidence === "mention"
      );

      navigation.push({
        routeId: route.id,
        ...(item.anchor ? { anchor: item.anchor } : {}),
        title: route.title,
        confident: !weak,
      });
    }

    const current = request.current?.routeId ? this.deps.routes.find(request.current.routeId) : undefined;

    return {
      question: request.question,
      locale: request.locale,
      scope: plan.scope,
      answerMode: plan.answerMode,
      evidence,
      symbols,
      corrections: findCorrections(request.question, this.deps.symbols),
      navigation,
      ...(current
        ? {
            current: {
              routeId: current.id,
              title: current.title,
              ...(request.current?.anchor ? { anchor: request.current.anchor } : {}),
              ...(request.current?.selectedText ? { selectedText: request.current.selectedText } : {}),
            },
          }
        : {}),
      budget: {
        total,
        reserved,
        evidenceAllowance,
        evidenceUsed: used,
        droppedForBudget,
        droppedAsRedundant: deduped.dropped + selected.dropped,
      },
      coverage: {
        coverageScore: plan.coverageScore,
        selectedFacetIds: plan.selectedFacetIds,
        readiness: plan.readiness,
      },
      empty: !request.report.coverage.covered || evidence.length === 0 || best <= 0,
    };
  }

  private membersOf(symbol: ApiSymbol): string[] {
    return this.deps.symbols
      .related(symbol.id)
      .filter((child) => child.parent === symbol.id)
      .map((child) => child.name)
      .sort();
  }

  /** The public path for a citation, for the link the reader clicks. */
  pathFor(evidence: Pick<ContextEvidence, "routeId" | "anchor">, locale: Locale): string | undefined {
    const path = this.deps.routes.resolve(evidence.routeId, locale);
    return path && evidence.anchor ? `${path}#${evidence.anchor}` : path;
  }

  /** The full entry behind a passage, when an answer needs more than the slice. */
  entryFor(evidence: Pick<ContextEvidence, "knowledgeId">) {
    return this.deps.knowledge.findById(evidence.knowledgeId);
  }
}

function fallbackPlan(report: RetrievalReport): CoveragePlan {
  const scope = report.exactSymbols.length > 0 ? "lookup" : "focused";
  return {
    scope,
    answerMode: scope === "lookup" ? "lookup" : "explain",
    seeds: report.results.slice(0, 5).map((result) => result.chunk.knowledgeId),
    expansion: { seeds: [], candidates: [], visited: 0, elapsedMs: 0 },
    candidates: [],
    facets: [],
    selected: report.results,
    selectedFacetIds: [],
    coverageScore: report.results.length > 0 ? 1 : 0,
    redundancyDropped: 0,
    readiness: {
      sufficient: report.coverage.covered && report.results.length > 0,
      coverage: report.results.length > 0 ? 1 : 0,
      evidenceCount: report.results.length,
      sourceConfidence: report.results.length > 0 ? 1 : 0,
    },
  };
}

/**
 * The header a passage is rendered with, costed alongside its text.
 *
 * Exported so the budget pays exactly what the prompt will. A flat allowance
 * was 24 tokens; a migration passage's warning alone is 40, which is how a
 * context that fitted a 2,000 token budget rendered as 2,040.
 */
export function evidenceHeader(
  evidence: Pick<ContextEvidence, "index" | "breadcrumb" | "routeId" | "showsRemovedApis">
): string {
  const warning = evidence.showsRemovedApis
    ? " — WARNING: quotes APIs REMOVED in 2.0 as counter-examples. Never write a name from this passage unless it also appears in the API surface."
    : "";

  return `[${evidence.index}] ${evidence.breadcrumb} (${evidence.routeId})${warning}`;
}

function toEvidence(
  result: RetrievalResult,
  index: number,
  role: EvidenceRole,
  best: number,
  facets: ContextEvidence["facets"],
  section: string,
  content: string
): ContextEvidence {
  const evidence: ContextEvidence = {
    knowledgeId: result.chunk.knowledgeId,
    chunkId: result.chunk.id,
    routeId: result.chunk.routeId,
    ...(result.chunk.anchor ? { anchor: result.chunk.anchor } : {}),
    index,
    breadcrumb: result.chunk.breadcrumb,
    title: result.chunk.title,
    content,
    role,
    reason: result.reason,
    // Relative to the best hit in this context: an absolute RRF score means
    // nothing to a reader, while "half as strong as the top one" does.
    confidence: best > 0 ? Math.round((result.finalScore / best) * 100) / 100 : 0,
    showsRemovedApis: result.chunk.showsRemovedApis,
    tokens: 0,
    facets,
    section,
  };

  evidence.tokens = estimateTokens(`${evidenceHeader(evidence)}\n${evidence.content}`);
  return evidence;
}
