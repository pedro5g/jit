import { type QueryTerm, tokenize, tokenizeQuery } from "./tokenize";
import type { DocSection, DocsIndex, RetrievedSection } from "./types";

/** Standard BM25 constants; b is lowered because sections vary a lot in length. */
const K1 = 1.2;
const B = 0.6;

/** A heading is a stronger signal than the same word buried in prose. */
const HEADING_REPEATS = 3;
const PAGE_TITLE_REPEATS = 2;

/** How much of a literal match a concept-derived term is worth. */
const CONCEPT_TERM_SCALE = 0.45;

/** Sections on the page being read win ties, but cannot beat a better answer. */
const CURRENT_PAGE_BOOST = 1.18;
const CURRENT_SECTION_BOOST = 1.3;

/**
 * How far the changelog and the migration guide fall when the question is not
 * about a version.
 *
 * They describe deltas — "Faster compilation and faster safeParse", "AOT:
 * typed source and reconstruction" — in the exact words a reader uses to ask
 * how the library works, and their sections are short enough that BM25's
 * length normalization rewards them for it. Left alone they take first place
 * for "why is jit fast" and "how does safeParse work", and the model then
 * explains the library as a list of recent changes to someone who has never
 * seen it. Ranked down rather than dropped: asked what changed in 2.0, they
 * are the answer.
 */
const HISTORY_PENALTY = 0.45;

/**
 * How far a table-shaped section falls. Milder than the changelog: an index
 * row is a correct, if thin, answer — "which API masks a field" is genuinely
 * answered by the operator matrix — it just must not outrank the page that
 * explains the thing.
 */
const DENSE_PENALTY = 0.75;

/**
 * How much a page the concept graph named is lifted.
 *
 * When the graph matches a concept from the words the reader actually typed, it
 * knows the subject with more certainty than BM25 does — the graph was written
 * by hand, term frequency was not. "como instalo a jit?" resolves to `install`,
 * whose page is the quick start, while lexically "instalo" shares no token with
 * an English index and the ranking is left to guess. A boost rather than an
 * override: a section that answers the question better still wins.
 */
const CONCEPT_PAGE_BOOST = 1.35;

interface IndexedSection {
  section: DocSection;
  frequencies: Map<string, number>;
  length: number;
}

export class DocsRetriever {
  private readonly indexed: IndexedSection[];
  private readonly documentFrequency = new Map<string, number>();
  private readonly averageLength: number;
  private readonly total: number;
  /** Populated only if the reader opts into the embedding model. */
  private vectors: Float32Array[] | null = null;

  constructor(readonly index: DocsIndex) {
    this.indexed = index.documents.map((section) => {
      const tokens = [
        ...tokenize(section.text),
        ...repeat(tokenize(section.heading), HEADING_REPEATS),
        // the breadcrumb, not the bare title: it carries the ancestor headings
        // that tell "equal › Performance" from "dto › Performance"
        ...repeat(tokenize(section.breadcrumb || section.page), PAGE_TITLE_REPEATS),
      ];

      const frequencies = new Map<string, number>();
      for (const token of tokens) frequencies.set(token, (frequencies.get(token) ?? 0) + 1);
      for (const token of frequencies.keys()) {
        this.documentFrequency.set(token, (this.documentFrequency.get(token) ?? 0) + 1);
      }

      return { section, frequencies, length: tokens.length };
    });

    this.total = this.indexed.length;
    this.averageLength = this.total === 0 ? 1 : this.indexed.reduce((sum, entry) => sum + entry.length, 0) / this.total;
  }

  /** Attaches embeddings computed elsewhere; retrieval turns hybrid from here. */
  setVectors(vectors: Float32Array[] | null) {
    this.vectors = vectors?.length === this.total ? vectors : null;
  }

  get hasVectors() {
    return this.vectors !== null;
  }

  /**
   * Ranks sections for one question. `queryVector` is optional: without it the
   * ranking is purely lexical, which is what the first seconds of a session
   * look like and what a reader who never downloads a model always gets.
   */
  search(
    query: string,
    options: {
      limit?: number;
      currentUrl?: string;
      queryVector?: Float32Array | null;
      /** Vocabulary the concept graph derived from the question. */
      conceptTerms?: QueryTerm[];
      /**
       * The question is about a version or a migration, so the changelog and
       * the migration guide compete on equal terms.
       */
      allowHistory?: boolean;
      /** Pages the concept graph named for this question, from the reader's own words. */
      conceptPages?: string[];
    } = {}
  ): RetrievedSection[] {
    const limit = options.limit ?? 6;
    const preferred = new Set(options.conceptPages ?? []);
    const terms = [
      ...tokenizeQuery(query),
      // The graph knows what the question is about; the words the reader typed
      // are still the evidence. Concept terms are scaled below a literal match
      // so an exact identifier always wins its own page.
      ...(options.conceptTerms ?? []).map((term) => ({
        term: term.term,
        weight: term.weight * CONCEPT_TERM_SCALE,
      })),
    ];
    if (terms.length === 0) return [];

    const lexical = this.bm25(terms);
    const topLexical = Math.max(...lexical, 1);
    const semantic = this.cosineScores(options.queryVector ?? null);

    const currentPath = options.currentUrl?.split("#")[0] ?? "";
    const results: RetrievedSection[] = [];

    for (let i = 0; i < this.total; i++) {
      // both signals are normalized to 0–1 so one cannot silently dominate
      const lexicalScore = lexical[i] / topLexical;
      const semanticScore = semantic ? semantic[i] : 0;
      if (lexicalScore === 0 && semanticScore < 0.2) continue;

      let score = semantic ? lexicalScore * 0.6 + semanticScore * 0.4 : lexicalScore;

      const { url, kind, dense } = this.indexed[i].section;
      if (kind === "history" && !options.allowHistory) score *= HISTORY_PENALTY;
      if (dense) score *= DENSE_PENALTY;
      if (preferred.size > 0 && preferred.has(url.split("#")[0])) score *= CONCEPT_PAGE_BOOST;

      if (currentPath && url === options.currentUrl) score *= CURRENT_SECTION_BOOST;
      else if (currentPath && url.split("#")[0] === currentPath) score *= CURRENT_PAGE_BOOST;

      results.push({ section: this.indexed[i].section, score, lexical: lexicalScore, semantic: semanticScore });
    }

    results.sort((a, b) => b.score - a.score);
    return dedupeByPage(results, limit);
  }

  private bm25(terms: QueryTerm[]): Float64Array {
    const scores = new Float64Array(this.total);

    for (const { term, weight } of terms) {
      const documentFrequency = this.documentFrequency.get(term);
      if (!documentFrequency) continue;

      // BM25's idf, in the form that stays positive for very common terms
      const idf = Math.log(1 + (this.total - documentFrequency + 0.5) / (documentFrequency + 0.5));

      for (let i = 0; i < this.total; i++) {
        const frequency = this.indexed[i].frequencies.get(term);
        if (!frequency) continue;

        const normalized = 1 - B + (B * this.indexed[i].length) / this.averageLength;
        scores[i] += weight * idf * ((frequency * (K1 + 1)) / (frequency + K1 * normalized));
      }
    }

    return scores;
  }

  private cosineScores(queryVector: Float32Array | null): Float64Array | null {
    const vectors = this.vectors;
    if (!vectors || !queryVector) return null;

    const scores = new Float64Array(this.total);
    for (let i = 0; i < this.total; i++) {
      // vectors are stored normalized, so the dot product is the cosine
      let dot = 0;
      const vector = vectors[i];
      for (let j = 0; j < queryVector.length; j++) dot += vector[j] * queryVector[j];
      scores[i] = Math.max(0, dot);
    }

    return scores;
  }
}

function repeat(tokens: string[], times: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < times; i++) out.push(...tokens);
  return out;
}

/**
 * Keeps an answer from being six slices of one page. Two sections per page is
 * enough for a follow-up question to still find its neighbours.
 */
function dedupeByPage(results: RetrievedSection[], limit: number): RetrievedSection[] {
  const perPage = new Map<string, number>();
  const kept: RetrievedSection[] = [];

  for (const result of results) {
    const page = result.section.url.split("#")[0];
    const seen = perPage.get(page) ?? 0;
    if (seen >= 2) continue;

    perPage.set(page, seen + 1);
    kept.push(result);
    if (kept.length >= limit) break;
  }

  return kept;
}
