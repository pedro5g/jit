/**
 * Whether the right knowledge survives selection.
 *
 * Recall@5 measures retrieval. It says nothing about the context, and the gap
 * between the two is where a small model actually fails: a passage that ranked
 * third and was then dropped as redundant, or crowded out by three conceptual
 * chunks, is a passage the model never saw. The answer is wrong for a reason
 * that never appears in a retrieval metric.
 *
 * So two numbers, and the second matters more than the first for a 0.8B.
 *
 * `contextRecall` — of the cases where retrieval found the expected page, how
 * often does the context still contain it. A drop here is a selection bug.
 *
 * `contamination` — how often the context carries a passage that is plausible
 * and about the wrong subject. This is the one that costs a small model its
 * answer: given a passage about `JIT.mask` while asked about `JIT.canonical`,
 * a 1.7B ignores it and a 0.8B writes about masking. Precision beats recall
 * here, which is the opposite of what a retrieval benchmark rewards.
 */
import type { ModelContext } from "../core/entities/model-context";
import type { RetrievalReport } from "../core/entities/retrieval";
import type { RouteId } from "../core/value-objects/ids";
import type { EvalCase } from "./types";

export interface ContextOutcome {
  case: EvalCase;
  /** The expected route was among the retrieved results. */
  retrieved: boolean;
  /** The expected route survived into the context. */
  selected: boolean;
  /**
   * Passages in the context that belong to neither the expected pages nor the
   * pages retrieval most agreed on.
   */
  contaminants: string[];
  evidenceCount: number;
  /** Whether the coverage gate found documentation for the question. */
  hasEvidence: boolean;
  tokens: number;
  roles: string[];
}

export function scoreContext(
  testCase: EvalCase,
  report: RetrievalReport,
  context: ModelContext,
  symbolsOf: (chunkId: string) => readonly string[]
): ContextOutcome {
  const expected = new Set<string>(testCase.expected.routes ?? []);
  const retrievedRoutes = new Set<string>(report.results.map((result) => result.chunk.routeId));
  const contextRoutes = context.evidence.map((evidence) => evidence.routeId);

  /**
   * What counts as contamination, and what the first definition got wrong.
   *
   * The obvious rule — a passage from a page the case did not list — reported
   * 32.6%, and reading the cases showed most of it was not noise. Asked how to
   * mask sensitive fields, the context carried "Boundary recipes › Safe logs",
   * which is a passage about masking data in logs. That is exactly the
   * supporting evidence a good context should hold; an eval case simply cannot
   * enumerate every page that legitimately covers a subject, and penalising
   * the selector for finding one would push it toward returning a single chunk
   * and nothing else.
   *
   * What genuinely contaminates is a passage about a *different subject*, and
   * the symbol graph already knows what a passage is about. "String operators
   * › ISO aliases" in an answer about ahead-of-time generation shares no API
   * with anything the question or its expected pages touch. That is the rule,
   * and it is derived rather than guessed.
   *
   * The weak-signal condition stays: a passage two retrievers agreed on is
   * evidence even when it looks unrelated.
   */
  const subject = new Set<string>(report.exactSymbols.map((symbol) => symbol.id));
  for (const result of report.results) {
    if (expected.has(result.chunk.routeId)) for (const id of symbolsOf(result.chunk.id)) subject.add(id);
  }

  const contaminants = context.evidence
    .filter((evidence) => expected.size > 0 && !expected.has(evidence.routeId))
    .filter((evidence) => evidence.reason !== "hybrid" && evidence.reason !== "exact-symbol")
    .filter((evidence) => evidence.confidence < 0.75)
    .filter((evidence) => {
      // Shares no API with the question's subject: a different topic, not a
      // second angle on the same one.
      const symbols = symbolsOf(evidence.chunkId);
      return subject.size > 0 && !symbols.some((id) => subject.has(id));
    })
    .map((evidence) => `${evidence.breadcrumb} (${evidence.reason})`);

  return {
    case: testCase,
    retrieved: [...expected].some((route) => retrievedRoutes.has(route)),
    selected: [...expected].some((route) => contextRoutes.includes(route as RouteId)),
    contaminants,
    evidenceCount: context.evidence.length,
    hasEvidence: !context.empty,
    tokens: context.budget.evidenceUsed + context.budget.reserved,
    roles: context.evidence.map((evidence) => evidence.role),
  };
}

export interface ContextMetrics {
  cases: number;
  /** Of the cases retrieval got right, how many survived selection. */
  contextRecall: number;
  /** Share of cases carrying at least one contaminant. */
  contamination: number;
  averageEvidence: number;
  averageTokens: number;
  /** Cases outside §38's 1500–2200 band, which should be rare and visible. */
  overBudget: number;
  underBudget: number;
  roleMix: Record<string, number>;
}

export function measureContext(outcomes: readonly ContextOutcome[]): ContextMetrics {
  const scored = outcomes.filter((outcome) => (outcome.case.expected.routes?.length ?? 0) > 0);
  const retrieved = scored.filter((outcome) => outcome.retrieved);

  const roleMix: Record<string, number> = {};
  for (const outcome of outcomes) {
    for (const role of outcome.roles) roleMix[role] = (roleMix[role] ?? 0) + 1;
  }

  const total = outcomes.length || 1;

  return {
    cases: outcomes.length,
    contextRecall:
      retrieved.length === 0 ? 1 : retrieved.filter((outcome) => outcome.selected).length / retrieved.length,
    contamination:
      scored.length === 0 ? 0 : scored.filter((outcome) => outcome.contaminants.length > 0).length / scored.length,
    averageEvidence: outcomes.reduce((sum, outcome) => sum + outcome.evidenceCount, 0) / total,
    averageTokens: Math.round(outcomes.reduce((sum, outcome) => sum + outcome.tokens, 0) / total),
    overBudget: outcomes.filter((outcome) => outcome.tokens > 2200).length,
    underBudget: outcomes.filter((outcome) => outcome.tokens < 1500).length,
    roleMix,
  };
}
