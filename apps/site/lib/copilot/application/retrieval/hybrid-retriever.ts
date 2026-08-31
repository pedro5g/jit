/**
 * Four retrievers, fused.
 *
 * The old assistant had one ranking with a weighted sum of two signals and a
 * growing pile of multipliers on top — a history penalty, a dense penalty, a
 * concept-page boost, a current-page boost. Each was added to fix one question
 * and each changed every other question, so tuning it was a game of
 * whack-a-mole with no way to tell whether a change was an improvement.
 *
 * Reciprocal rank fusion removes the tuning problem rather than solving it.
 * Each retriever ranks independently on whatever scale it likes; fusion only
 * reads the *rank*. A chunk at rank 3 in two retrievers beats a chunk at rank
 * 1 in one, which is the behaviour a weighted sum could never express without
 * the weights being wrong for some other query.
 *
 * The penalties that survive are applied after fusion, where they can reorder
 * near-ties but cannot overturn agreement between retrievers.
 */
import {
  CANDIDATES_PER_SIGNAL,
  CONTEXT_BOOSTS,
  FOLLOW_UP_CONTEXT_WEIGHT,
  FOLLOW_UP_SPECIFICITY,
  MAX_PER_ROUTE,
  NEAR_DUPLICATE,
  PENALTIES,
  RETRIEVAL_LIMIT,
  RRF_K,
} from "../../config/retrieval";
import type { ApiSymbol } from "../../core/entities/api-symbol";
import type { DocumentChunk } from "../../core/entities/document-chunk";
import type {
  QueryContext,
  RetrievalCandidate,
  RetrievalReport,
  RetrievalResult,
  RetrievalSignal,
} from "../../core/entities/retrieval";
import type { ChunkRepository, SymbolRepository, VectorRepository } from "../../core/repositories";
import type { ChunkId } from "../../core/value-objects/ids";
import type { StaticLexicalRepository } from "../../infrastructure/retrieval/lexical-repository";
import { detectMode, type RetrievalMode, type SignalWeights, weightsFor } from "./modes";
import { extractSymbolMentions } from "./symbol-query";
import { queryConcepts, tokenize, tokenizeQuery } from "./tokenizer";

export interface HybridRetrieverDeps {
  chunks: ChunkRepository;
  symbols: SymbolRepository;
  lexical: StaticLexicalRepository;
  vectors: VectorRepository;
}

export interface RetrieveOptions {
  context: QueryContext;
  /**
   * Which task this is (§ PART 1). Detected from the question when absent.
   *
   * Navigation and knowledge want different things from the same retrievers,
   * and the difference is measurable: semantic retrieval costs 4.4 points of
   * navigation accuracy and buys 2.3 points of Recall@5.
   */
  mode?: RetrievalMode;
  /** The embedded query, when an embedding model is available. */
  queryVector?: Float32Array | null;
  limit?: number;
  /** The question is about a version, so history pages compete on equal terms. */
  allowHistory?: boolean;
}

const EMPTY_SIGNALS: Record<RetrievalSignal, RetrievalCandidate[]> = {
  "exact-symbol": [],
  "prefix-symbol": [],
  lexical: [],
  semantic: [],
  "current-context": [],
};

export class HybridRetriever {
  constructor(private readonly deps: HybridRetrieverDeps) {}

  async retrieve(question: string, options: RetrieveOptions): Promise<RetrievalReport> {
    const bySignal: Record<RetrievalSignal, RetrievalCandidate[]> = { ...EMPTY_SIGNALS };
    const timings = { lexicalMs: 0, semanticMs: 0, symbolMs: 0, fusionMs: 0 };

    // ---------------------------------------------------------- symbols
    const symbolStart = performance.now();
    const { exact, candidates: symbolCandidates } = this.retrieveSymbols(question);
    bySignal["exact-symbol"] = symbolCandidates.filter((candidate) => candidate.signal === "exact-symbol");
    bySignal["prefix-symbol"] = symbolCandidates.filter((candidate) => candidate.signal === "prefix-symbol");
    timings.symbolMs = performance.now() - symbolStart;

    // ---------------------------------------------------------- lexical
    const lexicalStart = performance.now();
    const terms = tokenizeQuery(question);
    const specificity = this.deps.lexical.specificity(terms);
    const unknownTerms = queryConcepts(question)
      .filter((concept) => !concept.variants.some((variant) => this.deps.lexical.knows(variant)))
      .map((concept) => concept.literal);
    bySignal.lexical = this.deps.lexical.searchTerms(terms, CANDIDATES_PER_SIGNAL).map((match, index) => ({
      chunkId: match.chunkId,
      signal: "lexical" as const,
      rank: index + 1,
      score: match.score,
    }));
    timings.lexicalMs = performance.now() - lexicalStart;

    // --------------------------------------------------------- semantic
    const semanticStart = performance.now();
    if (options.queryVector && this.deps.vectors.available) {
      bySignal.semantic = this.deps.vectors.search(options.queryVector, CANDIDATES_PER_SIGNAL).map((match, index) => ({
        chunkId: match.chunkId,
        signal: "semantic" as const,
        rank: index + 1,
        score: match.score,
      }));
    }
    timings.semanticMs = performance.now() - semanticStart;

    // ---------------------------------------------------- current page
    bySignal["current-context"] = this.retrieveCurrentContext(options.context);

    // ------------------------------------------------------------ fuse
    const mode = options.mode ?? detectMode({ question, exactSymbols: exact.length });

    const fusionStart = performance.now();
    const results = this.fuse(bySignal, options, specificity, weightsFor(mode));
    timings.fusionMs = performance.now() - fusionStart;

    return {
      normalizedQuery: tokenize(question).join(" "),
      mode,
      exactSymbols: exact,
      coverage: {
        covered:
          exact.length > 0 ||
          (unknownTerms.length === 0 && (specificity > 0 || bySignal["current-context"].length > 0)),
        specificity,
        unknownTerms,
      },
      bySignal,
      results,
      semantic: describeSemantic(bySignal.semantic),
      timings,
    };
  }

  /**
   * §28: symbol lookup runs first, on every query, before any ranking.
   *
   * A reader who types `JIT.validate.safeParse` has told us the answer. Making
   * that a search problem is how the old assistant managed to rank the
   * migration guide above the validation reference for the name of a function.
   *
   * Two tiers, because "safeParse" and "como validar um uuid" are both symbol
   * questions and only one of them names a symbol out loud. What the reader
   * stated goes in at full weight; what the wording merely implies goes in
   * where three other retrievers can outvote it.
   */
  private retrieveSymbols(question: string): { exact: ApiSymbol[]; candidates: RetrievalCandidate[] } {
    const { stated, implied } = extractSymbolMentions(question);
    const exact: ApiSymbol[] = [];
    const weak: ApiSymbol[] = [];
    const seen = new Set<string>();

    const claim = (symbol: ApiSymbol, into: ApiSymbol[]) => {
      if (seen.has(symbol.id)) return;
      seen.add(symbol.id);
      into.push(symbol);
    };

    for (const mention of stated) {
      const symbol = this.deps.symbols.findExact(mention);
      if (symbol) {
        claim(symbol, exact);
        continue;
      }

      // §29: a near miss resolves to a symbol that exists, or to nothing. It
      // never invents one.
      for (const match of this.deps.symbols.search(mention, 3)) claim(match.symbol, weak);
    }

    /**
     * A bare word only counts when the index already knows it exactly.
     *
     * No prefix search here: "validar" would prefix-match `validate` and every
     * ordinary Portuguese word would drag in whatever it happened to share
     * three letters with. The lexical retriever is what handles a word that is
     * merely *about* an API; this is for a word that *is* one.
     */
    for (const word of implied) {
      const symbol = this.deps.symbols.findExact(word);
      if (symbol) claim(symbol, weak);
    }

    const candidates: RetrievalCandidate[] = [];
    let exactRank = 0;
    let weakRank = 0;

    for (const [symbols, signal] of [
      [exact, "exact-symbol"],
      [weak, "prefix-symbol"],
    ] as const) {
      for (const symbol of symbols) {
        /**
         * The page that documents the symbol, before the pages that use it.
         *
         * `examples` is evidence-ranked by the compiler, but every entry in it
         * is still just "a passage that names this API" — and eight of those
         * flattened into eight ranks means the authoritative page's chunk can
         * land at rank 6 while a guide that mentions the name in passing lands
         * at rank 1. `routeId` is a stronger claim than any of them: it is
         * where the reference table, or a heading, says the symbol lives.
         *
         * Measured on the 88 api-lookup cases, this is the difference between
         * the right page ranking second and ranking first.
         */
        const owned: string[] = [];
        const mentioned: string[] = [];

        for (const knowledgeId of symbol.examples) {
          for (const chunk of this.deps.chunks.byKnowledgeId(knowledgeId)) {
            (chunk.routeId === symbol.routeId ? owned : mentioned).push(chunk.id);
          }
        }

        for (const chunkId of [...owned, ...mentioned]) {
          candidates.push({
            chunkId: chunkId as ChunkId,
            signal,
            rank: signal === "exact-symbol" ? ++exactRank : ++weakRank,
            score: signal === "exact-symbol" ? 1 : 0.5,
          });
        }
      }
    }

    return { exact: [...exact, ...weak], candidates };
  }

  /**
   * §34: where the reader is standing, as a signal and never as a truth.
   *
   * A reader on the query page asking "how do I filter" almost certainly means
   * the page they are on. A reader on the query page asking "how do I validate
   * a uuid" does not, and the fusion is what tells those apart — this
   * retriever states a preference and the other three outvote it.
   */
  private retrieveCurrentContext(context: QueryContext): RetrievalCandidate[] {
    if (!context.routeId) return [];

    const onPage = this.deps.chunks.all().filter((chunk) => chunk.routeId === context.routeId);

    // The heading the reader is nearest to comes first: "and for arrays?" asked
    // under `## Collections` is about collections, and the page's intro is a
    // worse answer than the section in front of them.
    const ordered = context.anchor
      ? [...onPage].sort(
          (left, right) => Number(right.anchor === context.anchor) - Number(left.anchor === context.anchor)
        )
      : onPage;

    return ordered.slice(0, CANDIDATES_PER_SIGNAL).map((chunk, index) => ({
      chunkId: chunk.id,
      signal: "current-context" as const,
      rank: index + 1,
      score: chunk.anchor && chunk.anchor === context.anchor ? 1 : 0.5,
    }));
  }

  private fuse(
    bySignal: Record<RetrievalSignal, RetrievalCandidate[]>,
    options: RetrieveOptions,
    specificity: number,
    weights: SignalWeights
  ): RetrievalResult[] {
    // §34 normally: the page is a tie breaker. Below the specificity floor the
    // question has no subject of its own, and the page stops being a hint and
    // becomes the subject.
    const contextWeight = specificity < FOLLOW_UP_SPECIFICITY ? FOLLOW_UP_CONTEXT_WEIGHT : weights["current-context"];
    const fused = new Map<
      ChunkId,
      { score: number; signals: Set<RetrievalSignal>; scores: RetrievalResult["scores"] }
    >();

    for (const [signal, candidates] of Object.entries(bySignal) as [RetrievalSignal, RetrievalCandidate[]][]) {
      const weight = signal === "current-context" ? contextWeight : weights[signal];

      for (const candidate of candidates) {
        const entry = fused.get(candidate.chunkId) ?? {
          score: 0,
          signals: new Set<RetrievalSignal>(),
          scores: {} as RetrievalResult["scores"],
        };

        entry.score += weight / (RRF_K + candidate.rank);
        entry.signals.add(signal);

        if (signal === "lexical") entry.scores.lexical = candidate.score;
        else if (signal === "semantic") entry.scores.semantic = candidate.score;
        else if (signal === "current-context") entry.scores.context = candidate.score;
        else entry.scores.symbol = Math.max(entry.scores.symbol ?? 0, candidate.score);

        fused.set(candidate.chunkId, entry);
      }
    }

    const results: RetrievalResult[] = [];

    for (const [chunkId, entry] of fused) {
      const chunk = this.deps.chunks.findById(chunkId);
      if (!chunk) continue;

      let score = entry.score;
      if (chunk.kind === "migration" && !options.allowHistory) score *= PENALTIES.history;
      if (chunk.dense) score *= PENALTIES.dense;

      if (options.context.routeId === chunk.routeId) {
        score *= chunk.anchor === options.context.anchor ? CONTEXT_BOOSTS.currentSection : CONTEXT_BOOSTS.currentPage;
      }

      results.push({
        chunk,
        scores: entry.scores,
        finalScore: score,
        reason: reasonFor(entry.signals),
      });
    }

    results.sort((left, right) => right.finalScore - left.finalScore);
    return dedupe(results, options.limit ?? RETRIEVAL_LIMIT);
  }
}

/**
 * Which signal to credit. Agreement between two independent retrievers is the
 * strongest evidence the fusion produces, and it deserves its own name — an
 * eval failure reading `reason: "hybrid"` means something different from one
 * reading `reason: "lexical"`.
 */
function reasonFor(signals: ReadonlySet<RetrievalSignal>): RetrievalResult["reason"] {
  if (signals.size > 1) return "hybrid";
  const [only] = signals;
  return only ?? "lexical";
}

/**
 * Keeps an answer from being six slices of one page.
 *
 * Two limits, for two different failure modes. The per-route cap stops one
 * page from filling the context; the vocabulary-overlap check stops two pages
 * that say the same thing from both surviving it. Six near-identical passages
 * is the worst thing that can happen to a small model — most of the budget
 * spent restating one idea, and nothing else to reason from.
 */
function dedupe(results: RetrievalResult[], limit: number): RetrievalResult[] {
  const perRoute = new Map<string, number>();
  const kept: RetrievalResult[] = [];
  const keptTokens: Set<string>[] = [];

  for (const result of results) {
    const seen = perRoute.get(result.chunk.routeId) ?? 0;
    if (seen >= MAX_PER_ROUTE) continue;

    const tokens = new Set(tokenize(result.chunk.content));
    if (keptTokens.some((previous) => overlap(tokens, previous) > NEAR_DUPLICATE)) continue;

    perRoute.set(result.chunk.routeId, seen + 1);
    kept.push(result);
    keptTokens.push(tokens);

    if (kept.length >= limit) break;
  }

  return kept;
}

/** Share of the smaller passage's vocabulary that the larger one already has. */
function overlap(left: ReadonlySet<string>, right: ReadonlySet<string>): number {
  const [small, large] = left.size <= right.size ? [left, right] : [right, left];
  if (small.size === 0) return 0;

  let shared = 0;
  for (const token of small) if (large.has(token)) shared += 1;

  return shared / small.size;
}

/**
 * What the semantic retriever's scores look like, not just their order.
 *
 * §PART 2. E5 similarities cluster in a narrow band — 0.84 to 0.86 is typical
 * — and the instinct is to read that as a broken retriever. It is not: the
 * band is where the model puts everything, and what carries information is the
 * *separation* inside it. A top-1 of 0.8514 above a top-2 of 0.8509 is a coin
 * toss dressed as a ranking; 0.856 above 0.821 is a real preference.
 *
 * Measured and reported rather than acted on. Nothing in the ranking consumes
 * the margin yet, and it should not until the numbers say what a threshold
 * would be.
 */
function describeSemantic(candidates: readonly RetrievalCandidate[]): RetrievalReport["semantic"] {
  const top = candidates.slice(0, 3).map((candidate) => candidate.score);

  return {
    top,
    margin: top.length >= 2 ? top[0] - top[1] : 0,
    spread: top.length >= 3 ? top[0] - top[2] : 0,
  };
}

export type { DocumentChunk };
