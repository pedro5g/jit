/**
 * BM25 over the precomputed posting list.
 *
 * The scoring is the standard formula; what is different from the old
 * assistant is what it walks. That one held term frequencies per document and
 * looped over all 1,600 documents for every query term, because that is the
 * shape the index happened to have. This walks the postings for the handful of
 * terms a query actually contains, which is what an inverted index is for.
 */

import { type QueryTerm, tokenizeQuery } from "../../application/retrieval/tokenizer";
import { BM25 } from "../../config/retrieval";
import type { LexicalMatch } from "../../core/entities/retrieval";
import type { LexicalRepository } from "../../core/repositories";
import type { ChunkId } from "../../core/value-objects/ids";

export interface LexicalIndexDocument {
  chunks: string[];
  postings: Record<string, number[]>;
  lengths: number[];
  averageLength: number;
}

export class StaticLexicalRepository implements LexicalRepository {
  private readonly postings: Map<string, number[]>;
  private readonly chunks: readonly string[];
  private readonly lengths: readonly number[];
  private readonly averageLength: number;
  private readonly total: number;

  constructor(index: LexicalIndexDocument) {
    // Built as a Map, not read as an object: the corpus contains the tokens
    // `constructor` and `valueOf`, and `postings[token]` on a plain object
    // answers those from Object.prototype.
    this.postings = new Map(Object.entries(index.postings));
    this.chunks = index.chunks;
    this.lengths = index.lengths;
    this.averageLength = index.averageLength || 1;
    this.total = index.chunks.length;
  }

  /**
   * How much a query narrows the corpus, from 0 to 1.
   *
   * "how do I use this?" contains no term the index considers rare, so every
   * chunk matches it about equally and the lexical ranking that comes back is
   * noise with plausible-looking scores attached. "safeParse" contains one
   * that appears in eleven chunks out of 619.
   *
   * That difference is the whole basis for deciding whether a question has a
   * subject of its own or inherits one from the page the reader is on, and it
   * is measured rather than guessed: the maximum idf across the query's terms,
   * scaled against the idf a term appearing exactly once would have.
   */
  /**
   * Whether the corpus uses a word at all.
   *
   * The audit's sharpest grounding signal: a sentence that introduces
   * "postgres" or "graphql" is not a paraphrase of anything, because the
   * documentation has never written those words. Cheaper and far more precise
   * than measuring how much vocabulary a sentence shares.
   */
  knows(term: string): boolean {
    return this.postings.has(term);
  }

  specificity(terms: readonly QueryTerm[]): number {
    if (this.total === 0) return 0;

    const ceiling = this.idf(1);
    let best = 0;

    for (const { term } of terms) {
      const posting = this.postings.get(term);
      if (!posting) continue;
      best = Math.max(best, this.idf(posting.length / 2));
    }

    return Math.min(1, best / ceiling);
  }

  private idf(documentFrequency: number): number {
    return Math.log(1 + (this.total - documentFrequency + 0.5) / (documentFrequency + 0.5));
  }

  search(query: string, limit: number): LexicalMatch[] {
    return this.searchTerms(tokenizeQuery(query), limit);
  }

  searchTerms(terms: readonly QueryTerm[], limit: number): LexicalMatch[] {
    if (terms.length === 0 || this.total === 0) return [];

    const scores = new Map<number, number>();

    for (const { term, weight } of terms) {
      const posting = this.postings.get(term);
      if (!posting) continue;

      // BM25's idf, in the form that stays positive for very common terms
      const idf = this.idf(posting.length / 2);

      for (let i = 0; i < posting.length; i += 2) {
        const position = posting[i];
        const frequency = posting[i + 1];

        const normalized = 1 - BM25.b + (BM25.b * this.lengths[position]) / this.averageLength;
        const contribution = weight * idf * ((frequency * (BM25.k1 + 1)) / (frequency + BM25.k1 * normalized));

        scores.set(position, (scores.get(position) ?? 0) + contribution);
      }
    }

    return [...scores.entries()]
      .sort((left, right) => right[1] - left[1])
      .slice(0, limit)
      .map(([position, score]) => ({ chunkId: this.chunks[position] as ChunkId, score }));
  }
}
