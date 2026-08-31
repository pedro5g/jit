import type { ChunkId, RouteId, SymbolId } from "../value-objects/ids";
import type { Locale } from "../value-objects/locale";
import type { ApiSymbol } from "./api-symbol";
import type { DocumentChunk } from "./document-chunk";

/** Which retriever produced a candidate. Every one of them runs independently. */
export type RetrievalSignal = "exact-symbol" | "prefix-symbol" | "lexical" | "semantic" | "current-context";

/**
 * One retriever's opinion, before fusion.
 *
 * Rank is carried alongside score because reciprocal rank fusion consumes the
 * rank and the debug panel consumes the score. Keeping both means neither
 * retriever has to normalize its scores to a shared scale — which was the
 * thing that made the old weighted sum impossible to tune without breaking
 * something else.
 */
export interface RetrievalCandidate {
  chunkId: ChunkId;
  signal: RetrievalSignal;
  /** 1-based, within this signal's own result list. */
  rank: number;
  /** This retriever's raw score, on whatever scale it uses. */
  score: number;
}

/**
 * A fused, ranked hit — what the context builder and the debug panel consume.
 *
 * `scores` keeps every contributing signal so "why this source" is answerable
 * without re-running retrieval, and so an eval failure says which retriever
 * missed rather than just that the answer was wrong.
 */
export interface RetrievalResult {
  chunk: DocumentChunk;

  scores: {
    lexical?: number;
    semantic?: number;
    symbol?: number;
    context?: number;
  };

  finalScore: number;

  /**
   * The signal that carried this hit. `hybrid` means no single one did — two
   * or more agreed, which is the strongest evidence the fusion produces.
   */
  reason: RetrievalSignal | "hybrid";
}

/** Everything the retriever is told about where the reader is standing. */
export interface QueryContext {
  /** The page being read, when there is one. Never a source of truth — a signal. */
  routeId?: RouteId;
  /** Heading the reader is nearest to. */
  anchor?: string;
  /** Text the reader selected before asking. */
  selection?: string;
  /** The language the reply should be in. */
  locale: Locale;
}

/**
 * A retrieval run, start to finish.
 *
 * Returned rather than logged, because `knowledge:inspect` and the browser
 * debug panel render the same object and the eval suite asserts on it. A
 * retriever that only logs its intermediate steps cannot be tested.
 */
export interface RetrievalReport {
  /** The query as the retrievers saw it, after normalization. */
  normalizedQuery: string;
  /** Which task the ranking was tuned for. */
  mode: "knowledge" | "navigation";
  /** Symbols the query named outright, before any ranking. */
  exactSymbols: ApiSymbol[];
  /** Whether the corpus contains every subject introduced by the question. */
  coverage: {
    covered: boolean;
    specificity: number;
    /** Reader-written concepts for which neither a literal nor a synonym exists. */
    unknownTerms: string[];
  };
  /** Per-signal candidate lists, in the order each retriever produced them. */
  bySignal: Record<RetrievalSignal, RetrievalCandidate[]>;
  results: RetrievalResult[];
  /**
   * The semantic retriever's raw scores and how far apart they are.
   *
   * E5 similarities live in a narrow band, so their order is more informative
   * than their magnitude — but the *gap* between the top two carries real
   * signal, and it is invisible unless it is recorded.
   */
  semantic: { top: number[]; margin: number; spread: number };
  timings: { lexicalMs: number; semanticMs: number; symbolMs: number; fusionMs: number };
}

/** A symbol hit, with how it was matched — exact beats prefix, always. */
export interface SymbolMatch {
  symbol: ApiSymbol;
  kind: "exact" | "prefix" | "fuzzy";
  /** 0–1. Exact is always 1. */
  score: number;
}

export interface VectorMatch {
  chunkId: ChunkId;
  /** Cosine similarity; vectors are stored normalized so it is a dot product. */
  score: number;
}

export interface LexicalMatch {
  chunkId: ChunkId;
  /** BM25, unnormalized. */
  score: number;
}

/** Symbol ids the audit is allowed to treat as real. */
export type KnownSymbols = ReadonlySet<SymbolId>;
