import type { ChunkId, KnowledgeId, RouteId } from "../value-objects/ids";
import type { Locale } from "../value-objects/locale";
import type { ApiSymbol } from "./api-symbol";

/**
 * The context as data, before anything turns it into a prompt.
 *
 * The separation is the point. `ModelContext` is what was selected and why;
 * serializing it into messages is a later, model-specific step. That is what
 * lets the selection be tested without a model, measured without a prompt, and
 * audited afterwards against the same object the model actually saw.
 *
 * It also removes the failure this replaces: a context that was a concatenated
 * string had no way to answer "where did that sentence come from?", so the
 * audit had to re-derive provenance by searching the sources — which it got
 * wrong whenever two passages shared a phrase.
 */

/** What a piece of evidence is, so no one kind can eat the whole budget. */
export type EvidenceRole = "symbol" | "concept" | "reference" | "guide" | "example" | "history" | "current-context";

/**
 * One passage, with its provenance attached.
 *
 * Never a bare string. Everything downstream — the citation the reader clicks,
 * the audit's grounding check, the debug panel's "why this source" — needs to
 * know where the text came from, and reconstructing that later is guesswork.
 */
export interface ContextEvidence {
  knowledgeId: KnowledgeId;
  chunkId: ChunkId;
  routeId: RouteId;
  anchor?: string;

  /** 1-based; this is the number the model cites and the reader sees. */
  index: number;
  breadcrumb: string;
  title: string;
  content: string;

  role: EvidenceRole;
  /** Which retriever carried this hit. */
  reason: "exact-symbol" | "prefix-symbol" | "lexical" | "semantic" | "current-context" | "hybrid";
  /** The fused score, normalized against the best hit in this context. */
  confidence: number;

  /** The passage quotes APIs the library no longer has. */
  showsRemovedApis: boolean;
  tokens: number;
}

/** A name the question asked about, stated as truth rather than retrieved. */
export interface ContextSymbol {
  symbol: ApiSymbol;
  /** Schema kinds a chain method is allowed on — the part reflection cannot see. */
  validOn: string[];
  /** Members, when this is a namespace. */
  members: string[];
  /**
   * How strongly the documentation associates this symbol with its page.
   *
   * Carried through so a navigation offer can eventually refuse a page that
   * merely mentions the symbol. Not yet enforced.
   */
  routeConfidence?: ApiSymbol["routeConfidence"];
}

/** A name the question wrote that does not exist, and what does. */
export interface ContextCorrection {
  written: string;
  /** The real name, or the members of the namespace it reached through. */
  suggestion: string;
}

/** Somewhere the answer may offer to send the reader. */
export interface ContextNavigation {
  routeId: RouteId;
  anchor?: string;
  title: string;
  /** False when the route was inferred from a passing mention. */
  confident: boolean;
}

export interface ContextBudget {
  /** What the whole prompt is allowed to cost. */
  total: number;
  /** What the fixed blocks cost: rules, symbol truth, corrections, surface. */
  reserved: number;
  /** What the evidence was allowed, and what it used. */
  evidenceAllowance: number;
  evidenceUsed: number;
  /** Candidates dropped for budget rather than for redundancy. */
  droppedForBudget: number;
  droppedAsRedundant: number;
}

export interface ModelContext {
  question: string;
  locale: Locale;

  evidence: ContextEvidence[];
  symbols: ContextSymbol[];
  corrections: ContextCorrection[];
  navigation: ContextNavigation[];

  /** Where the reader is standing. Context, never authority. */
  current?: { routeId: RouteId; title: string; anchor?: string; selectedText?: string };

  budget: ContextBudget;

  /**
   * Retrieval returned nothing at all.
   *
   * Narrow on purpose. A score threshold cannot tell a covered question from
   * an uncovered one — measured, "why is jit fast?" and "does jit support
   * graphql subscriptions?" produce identical fused scores — so this fires
   * only on genuine emptiness and the audit carries the rest.
   */
  empty: boolean;
}
