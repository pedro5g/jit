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
import { CONTEXT_BUDGET, MIN_EVIDENCE_CONFIDENCE } from "../../config/retrieval";
import type { ApiSymbol } from "../../core/entities/api-symbol";
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
    const total = request.budget ?? CONTEXT_BUDGET.target;
    const reserved = request.reservedTokens ?? 0;

    /**
     * At least a third of the budget stays with the documentation, whatever
     * the fixed half grows to. A prompt that is all rules and no evidence is a
     * prompt answered from memory — which is the failure every one of those
     * rules is trying to prevent.
     */
    const evidenceAllowance = Math.max(Math.round(total / 3), total - reserved);

    // ---------------------------------------------- classify and deduplicate
    const roles = new Map<string, EvidenceRole>();
    for (const result of request.report.results) roles.set(result.chunk.id, classify(result));
    const roleOf = (result: RetrievalResult) => roles.get(result.chunk.id) ?? "reference";

    const deduped = dedupe(request.report.results);
    const selected = selectByRole(request.report.coverage.covered ? deduped.kept : [], roleOf);

    // ------------------------------------------------------- allocate budget
    const best = request.report.results[0]?.finalScore ?? 0;
    const evidence: ContextEvidence[] = [];
    let used = 0;
    let droppedForBudget = 0;

    for (const result of selected.kept) {
      const candidate = toEvidence(result, evidence.length + 1, roleOf(result), best);

      // A passage worth a fraction of the top hit is attention a small model
      // spends badly. The first one is exempt: something beats nothing.
      if (evidence.length > 0 && candidate.confidence < MIN_EVIDENCE_CONFIDENCE) {
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
    const symbols: ContextSymbol[] = request.report.exactSymbols.slice(0, 4).map((symbol) => ({
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

function toEvidence(result: RetrievalResult, index: number, role: EvidenceRole, best: number): ContextEvidence {
  const evidence: ContextEvidence = {
    knowledgeId: result.chunk.knowledgeId,
    chunkId: result.chunk.id,
    routeId: result.chunk.routeId,
    ...(result.chunk.anchor ? { anchor: result.chunk.anchor } : {}),
    index,
    breadcrumb: result.chunk.breadcrumb,
    title: result.chunk.title,
    content: result.chunk.content,
    role,
    reason: result.reason,
    // Relative to the best hit in this context: an absolute RRF score means
    // nothing to a reader, while "half as strong as the top one" does.
    confidence: best > 0 ? Math.round((result.finalScore / best) * 100) / 100 : 0,
    showsRemovedApis: result.chunk.showsRemovedApis,
    tokens: 0,
  };

  evidence.tokens = estimateTokens(`${evidenceHeader(evidence)}\n${evidence.content}`);
  return evidence;
}
