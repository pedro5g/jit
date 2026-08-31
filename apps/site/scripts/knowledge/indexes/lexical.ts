/**
 * The BM25 posting list, built once at compile time.
 *
 * The old assistant tokenized all 1,600 sections in the browser, on the main
 * thread, every time the panel opened. It took long enough to be visible and
 * produced exactly the same result each time, from inputs that were fixed at
 * build time — which is §3.2's whole argument in one example.
 *
 * The shipped form is a posting list rather than a term-frequency table per
 * document: the query touches a handful of terms and needs the documents for
 * each, so storing it the other way round means scanning every document for
 * every term. That is what the runtime did.
 */

import { tokenize } from "../../../lib/copilot/application/retrieval/tokenizer";
import { FIELD_REPEATS } from "../../../lib/copilot/config/retrieval";
import type { DocumentChunk } from "../../../lib/copilot/core/entities/document-chunk";

export interface LexicalIndex {
  /** Chunk ids, in the order the postings refer to them. */
  chunks: string[];
  /**
   * Token -> [chunk position, term frequency] pairs, flattened.
   *
   * Built through a `Map` and only turned into an object to be serialized.
   * The documentation contains the words `constructor`, `toString` and
   * `valueOf`, and `postings[token] ??= []` on a plain object finds
   * `Object.prototype.constructor` — truthy, so the `??=` never fires and the
   * push lands on a Function. The reader on the other side rebuilds a `Map`
   * for the same reason.
   */
  postings: Record<string, number[]>;
  /** Token count per chunk, for BM25's length normalization. */
  lengths: number[];
  averageLength: number;
}

export function buildLexicalIndex(chunks: readonly DocumentChunk[]): LexicalIndex {
  const postings = new Map<string, number[]>();
  const lengths: number[] = [];

  for (const [position, chunk] of chunks.entries()) {
    // A term in a heading is a stronger statement about what a passage is
    // about than the same term buried in prose. The breadcrumb rather than the
    // bare title, because it carries the ancestors that tell
    // "equal › Performance" from "dto › Performance".
    const tokens = [
      ...tokenize(chunk.content),
      ...repeat(tokenize(chunk.title), FIELD_REPEATS.heading),
      ...repeat(tokenize(chunk.breadcrumb), FIELD_REPEATS.breadcrumb),
    ];

    const frequencies = new Map<string, number>();
    for (const token of tokens) frequencies.set(token, (frequencies.get(token) ?? 0) + 1);

    for (const [token, frequency] of frequencies) {
      const posting = postings.get(token);
      if (posting) posting.push(position, frequency);
      else postings.set(token, [position, frequency]);
    }

    lengths.push(tokens.length);
  }

  return {
    chunks: chunks.map((chunk) => chunk.id),
    // sorted so two builds of the same tree serialize identically
    postings: Object.fromEntries([...postings].sort(([left], [right]) => left.localeCompare(right))),
    lengths,
    averageLength: lengths.length === 0 ? 1 : lengths.reduce((sum, length) => sum + length, 0) / lengths.length,
  };
}

function repeat(tokens: string[], times: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < times; i++) out.push(...tokens);
  return out;
}
