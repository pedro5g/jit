/**
 * Two retrieval tasks, not one ranking with a knob.
 *
 * The measurement that forced this: navigation accuracy is 97.8% with the
 * semantic retriever off and 93.4% with it on, while Recall@5 moves the other
 * way — 93.0% to 95.3%. Semantic retrieval genuinely helps find *material* and
 * genuinely hurts picking *the* page.
 *
 * The tempting fix is to lower the semantic weight until both numbers look
 * acceptable, which is how the old assistant accumulated six multipliers that
 * nobody could reason about. The real explanation is simpler and it is not a
 * tuning problem: these are different questions.
 *
 *   "Which page is this?" has one right answer. The reader named a symbol or a
 *   subject, and an exact match is not a ranking signal — it is the answer.
 *   Meaning-similarity can only add near-misses to a list that was already
 *   correct at rank one.
 *
 *   "Explain this to me" has no single right answer. Four passages from
 *   different angles beat one, and meaning-similarity is what finds the
 *   Portuguese question's English passage.
 *
 * So the mode selects a weighting profile, and nothing else changes. One
 * retriever, one fusion, two profiles — rather than a branch inside the
 * ranking loop.
 */
import { SIGNAL_WEIGHTS } from "../../config/retrieval";
import type { RetrievalSignal } from "../../core/entities/retrieval";

export type RetrievalMode = "knowledge" | "navigation";

export type SignalWeights = Record<RetrievalSignal, number>;

/**
 * Navigation: exact symbol, then route evidence, then words, and semantic only
 * as recall expansion.
 *
 * Semantic sits an order of magnitude below the rest rather than at zero. Set
 * to zero it stops rescuing the questions where nothing matched lexically at
 * all — a Portuguese question naming no identifier — and those are the ones
 * that need it most. At 0.15 it can still surface a page no other retriever
 * found, and cannot displace one they all agreed on.
 */
const NAVIGATION_WEIGHTS: SignalWeights = {
  "exact-symbol": 4,
  "prefix-symbol": 1.5,
  lexical: 1.2,
  semantic: 0.15,
  "current-context": 0.6,
};

export function weightsFor(mode: RetrievalMode): SignalWeights {
  return mode === "navigation" ? NAVIGATION_WEIGHTS : { ...SIGNAL_WEIGHTS };
}

/**
 * Which task a question is.
 *
 * Deliberately conservative: the default is `knowledge`, because answering an
 * explanatory question with a navigation ranking loses the supporting
 * passages, while answering a navigation question with a knowledge ranking
 * loses at most a place or two in the ordering.
 *
 * The signals are all structural rather than semantic — a named API, an
 * imperative to go somewhere, a bare noun phrase with no question in it. None
 * of this is trying to understand the question; it is asking whether the
 * question already contains its own answer.
 */
const NAVIGATION_PHRASES =
  /\b(where|which page|take me|go to|show me the (?:page|docs|reference)|open the|find the (?:page|docs)|install|onde|qual p[áa]gina|me leva|abre? a|abrir?|instal(?:ar|o|a[çc][ãa]o))\b/i;

/** "what does X do", "how do I use X" — an API lookup, which is navigation. */
const LOOKUP_PHRASES = /\b(what (?:does|is)|how do I use|o que (?:faz|é)|como uso|documenta[çc][ãa]o (?:de|do|da))\b/i;

export interface ModeInput {
  question: string;
  /** Resolved symbols, including weak bare-name matches, for compatibility. */
  exactSymbols: number;
  /** Symbols the reader explicitly wrote as API syntax. */
  explicitSymbols?: number;
}

export function detectMode({ question, exactSymbols, explicitSymbols = exactSymbols }: ModeInput): RetrievalMode {
  if (NAVIGATION_PHRASES.test(question)) return "navigation";

  /**
   * A named API plus a lookup phrasing is a navigation question.
   *
   * "what does JIT.mask do?" wants the mask reference; "how does masking keep
   * data out of logs?" wants an explanation, and only the first names a
   * symbol. The conjunction matters: a lookup phrasing on its own ("what is a
   * DTO?") is conceptual, and a symbol on its own ("JIT.mask drops fields,
   * right?") is a claim to check rather than a place to go.
   */
  if (explicitSymbols > 0 && LOOKUP_PHRASES.test(question)) return "navigation";

  // A bare identifier, with no sentence around it, is someone looking a name up.
  if (explicitSymbols > 0 && question.trim().split(/\s+/).length <= 3) return "navigation";

  return "knowledge";
}
