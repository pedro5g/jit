/**
 * Every number the retrieval stack is tuned by, in one file.
 *
 * They were spread across four modules in the old assistant and each one was
 * tuned against a different question. Collecting them is not tidiness: the
 * eval suite sweeps them, and a constant that lives next to the code that uses
 * it is a constant nobody sweeps.
 */

/** Standard BM25. `b` is low because sections vary enormously in length. */
export const BM25 = { k1: 1.2, b: 0.6 } as const;

/** A term in a heading outweighs the same term buried in prose. */
export const FIELD_REPEATS = { heading: 3, breadcrumb: 2 } as const;

/**
 * Reciprocal rank fusion's damping constant.
 *
 * 60 is the value from the original paper and it is a good default for a
 * reason: it is large enough that ranks 1 and 2 are not wildly far apart, so a
 * single retriever cannot win on its own the way it does with a weighted sum.
 * Two retrievers agreeing at rank 3 beats one retriever's rank 1, which is
 * exactly the behaviour we want and the thing weights kept failing to express.
 */
export const RRF_K = 60;

/**
 * How much each signal is trusted, before fusion.
 *
 * These multiply a signal's RRF contribution rather than its score, so they
 * stay meaningful when a retriever's scale changes. Exact symbol matches sit
 * far above everything because they are not a ranking at all — the reader
 * named the thing.
 */
export const SIGNAL_WEIGHTS = {
  "exact-symbol": 3,
  "prefix-symbol": 1.2,
  lexical: 1,
  semantic: 1,
  "current-context": 0.6,
} as const;

/** How many candidates each retriever contributes to the fusion. */
export const CANDIDATES_PER_SIGNAL = 20;

/** How many fused results the context builder may consider. */
export const RETRIEVAL_LIMIT = 8;

/**
 * Penalties, applied after fusion so they cannot flip a unanimous result.
 *
 * `history` is the changelog and the migration guide: right when the question
 * is about a version, actively misleading when it is about how the library
 * behaves today. `dense` is a table — a correct answer that explains nothing.
 */
export const PENALTIES = { history: 0.45, dense: 0.75 } as const;

/** Chunks on the page being read win ties; they never beat a better answer. */
export const CONTEXT_BOOSTS = { currentPage: 1.18, currentSection: 1.3 } as const;

/**
 * Below this query specificity, the question has no subject of its own.
 *
 * "how do I use this?" and "and for arrays?" are complete questions to a
 * reader looking at a page and empty ones to a retriever: every term is
 * common, so the lexical ranking is noise with plausible scores attached and
 * the semantic one is not much better. The page being read is then not a tie
 * breaker, it is the only evidence there is — so the context signal is
 * promoted to the weight an explicitly named symbol would carry.
 *
 * Measured, not guessed: specificity is the maximum idf across the query's
 * terms, scaled against a term that appears exactly once. 0.35 sits between
 * "how do I use this" (0.24 against the current corpus) and "how do I filter a
 * large list" (0.52).
 */
export const FOLLOW_UP_SPECIFICITY = 0.35;

/** What the current page is worth once the question is known to have no subject. */
export const FOLLOW_UP_CONTEXT_WEIGHT = 3;

/**
 * Vocabulary overlap above which one chunk is redundant given another.
 *
 * Loose enough that two pages covering the same API from different angles both
 * survive; tight enough that one paragraph chunked twice does not. Six
 * near-identical slices is the worst thing that can happen to a small model's
 * context — most of the budget spent restating one idea, and nothing else to
 * work from.
 */
export const NEAR_DUPLICATE = 0.72;

/** At most this many chunks from any one page. */
export const MAX_PER_ROUTE = 2;

/**
 * The context budget, in approximate tokens (§38).
 *
 * The ceiling exists because small models degrade with context length rather
 * than improving: a 0.8B given 4000 tokens of documentation starts averaging
 * across passages instead of reading the relevant one. Maximum factual
 * density, minimum redundancy.
 */
export const CONTEXT_BUDGET = { target: 1400, hard: 2000 } as const;

/**
 * The fused score a confidently-retrieved result reaches.
 *
 * Used to normalize the retrieval confidence number, and nothing else. It was
 * a gate — below this, refuse to answer — and measurement killed that idea:
 * "why is jit fast?" and "does jit support graphql subscriptions?" both score
 * exactly 0.01639, because a single retriever at rank one is the floor a
 * reciprocal-rank score saturates at, and RRF discards magnitude on purpose.
 *
 * Deciding whether the corpus covers a question turns out not to be knowable
 * from a score. It is knowable from the answer, which is where the grounding
 * validator does it.
 */
export const MIN_USABLE_SCORE = 0.015;

/**
 * The weakest passage worth putting in front of a small model, as a fraction
 * of the best one in the same context.
 *
 * The principle is that for a small model, context precision beats context
 * recall — a passage about string operators, handed to a 0.8B asked about
 * ahead-of-time generation, does not get ignored; it gets written about. This
 * is the lever, and the value came from a sweep rather than from taste:
 *
 *   floor   context recall   contamination   passages   prompt
 *   0.30   100.0%            11.6%           3.6        1588
 *   0.50    99.2%             6.2%           3.1        1512
 *   0.60    97.6%             0.0%           2.9        1492
 *
 * The 0.50 point still misses the <5% contamination target. At 0.60 the
 * measured contamination reaches zero while context recall remains above 97%.
 * Re-run the sweep before changing it; the shape of the curve is the argument,
 * not the number.
 */
export const MIN_EVIDENCE_CONFIDENCE = 0.6;
