/**
 * What a right retrieval looks like, and how it is measured.
 *
 * The old gold set named URLs. That made every case a hostage to the site's
 * routing — renaming a page silently invalidated the expectation, so the set
 * measured whether the URLs had changed as much as whether retrieval worked.
 * §71's shape names symbols and route ids instead, which survive a rename by
 * construction.
 */
import type { FacetId, RouteId, SymbolId } from "../core/value-objects/ids";
import type { Locale } from "../core/value-objects/locale";

/** §70's categories, so a regression can be attributed rather than just noticed. */
export type EvalCategory =
  | "api-lookup"
  | "concept"
  | "navigation"
  | "simple-code"
  | "complex-code"
  | "ambiguous"
  | "follow-up"
  | "negative"
  | "hallucination-trap";

export interface EvalCase {
  question: string;
  category: EvalCategory;
  locale: Locale;

  expected: {
    /** Symbols exact lookup must resolve. Empty when the question names none. */
    symbols?: SymbolId[];
    /** Routes that must appear among the results. */
    routes?: RouteId[];
    /** The route that must rank first. */
    best?: RouteId;
    /** Compiler-derived facet ids expected in a broad explanation. */
    facets?: FacetId[];
  };

  /**
   * Routes that must NOT reach the top three.
   *
   * The single most valuable field in the set. The migration guide ranking
   * first for "how does safeParse work" is not a near miss — it produces an
   * answer that describes a change to someone who has never seen the thing
   * being changed, with a citation that makes it look researched.
   */
  forbidden?: RouteId[];

  /**
   * The question has no answer in the documentation and retrieval should say
   * so rather than return its best guess (§58).
   */
  expectsNoEvidence?: boolean;

  /** Where the reader was standing, for cases that depend on it (§34). */
  context?: { routeId?: RouteId; anchor?: string };

  /** Why this case exists, when it is not obvious. */
  note?: string;
}

export interface CaseOutcome {
  case: EvalCase;
  /** Routes returned, best first. */
  routes: RouteId[];
  /** Symbols exact lookup resolved. */
  symbols: SymbolId[];
  /** 1-based rank of the first expected route, or 0 when none was returned. */
  firstHit: number;
  bestCorrect: boolean;
  symbolsCorrect: boolean;
  forbiddenHits: RouteId[];
  topScore: number;
  /** Which ranking profile the retriever chose for this question. */
  mode: "knowledge" | "navigation";
  /** Semantic top-1 minus top-2 — a coin toss below ~0.005. */
  semanticMargin: number;
}

export interface EvalMetrics {
  cases: number;
  /** §72's headline numbers. */
  recallAt1: number;
  recallAt3: number;
  recallAt5: number;
  mrr: number;
  /** Share of cases naming a symbol where exact lookup resolved every one. */
  exactSymbolAccuracy: number;
  /** Share of cases whose `best` route ranked first. */
  navigationAccuracy: number;
  /** Cases where a forbidden route reached the top three. */
  forbiddenHits: number;
  byCategory: Record<string, { cases: number; recallAt5: number; mrr: number }>;
  /** Navigation accuracy split by the mode the retriever actually chose. */
  byMode: Record<string, { cases: number; recallAt1: number; navigation: number }>;
}

export function measure(outcomes: readonly CaseOutcome[]): EvalMetrics {
  const scored = outcomes.filter((outcome) => (outcome.case.expected.routes?.length ?? 0) > 0);
  const withSymbols = outcomes.filter((outcome) => (outcome.case.expected.symbols?.length ?? 0) > 0);
  const withBest = outcomes.filter((outcome) => outcome.case.expected.best);

  const share = (list: readonly CaseOutcome[], predicate: (outcome: CaseOutcome) => boolean) =>
    list.length === 0 ? 1 : list.filter(predicate).length / list.length;

  const recallAt = (limit: number) => share(scored, (outcome) => outcome.firstHit > 0 && outcome.firstHit <= limit);

  const byCategory: EvalMetrics["byCategory"] = {};
  for (const outcome of scored) {
    const bucket = (byCategory[outcome.case.category] ??= { cases: 0, recallAt5: 0, mrr: 0 });
    bucket.cases += 1;
    if (outcome.firstHit > 0 && outcome.firstHit <= 5) bucket.recallAt5 += 1;
    bucket.mrr += outcome.firstHit > 0 ? 1 / outcome.firstHit : 0;
  }

  for (const bucket of Object.values(byCategory)) {
    bucket.recallAt5 /= bucket.cases;
    bucket.mrr /= bucket.cases;
  }

  const byMode: EvalMetrics["byMode"] = {};
  for (const outcome of outcomes) {
    const bucket = (byMode[outcome.mode] ??= { cases: 0, recallAt1: 0, navigation: 0 });
    bucket.cases += 1;
    if (outcome.firstHit === 1) bucket.recallAt1 += 1;
    if (outcome.bestCorrect) bucket.navigation += 1;
  }

  for (const bucket of Object.values(byMode)) {
    bucket.recallAt1 /= bucket.cases;
    bucket.navigation /= bucket.cases;
  }

  return {
    cases: outcomes.length,
    recallAt1: recallAt(1),
    recallAt3: recallAt(3),
    recallAt5: recallAt(5),
    mrr:
      scored.length === 0
        ? 1
        : scored.reduce((sum, outcome) => sum + (outcome.firstHit > 0 ? 1 / outcome.firstHit : 0), 0) / scored.length,
    exactSymbolAccuracy: share(withSymbols, (outcome) => outcome.symbolsCorrect),
    navigationAccuracy: share(withBest, (outcome) => outcome.bestCorrect),
    forbiddenHits: outcomes.filter((outcome) => outcome.forbiddenHits.length > 0).length,
    byCategory,
    byMode,
  };
}
