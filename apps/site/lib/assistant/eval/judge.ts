import type { DocsRetriever } from "../retrieval";
import type { DocsIndex } from "../types";
import { conceptPages, conceptTerms, understand } from "../understanding";
import type { GoldQuestion } from "./gold";

/**
 * Runs one gold question through exactly the path the assistant takes, and
 * reports the four things that can go wrong independently.
 *
 * Shared by the vitest suite, which pins these as floors, and by the
 * `eval:ghost` script, which prints the detail needed to move them. Having one
 * implementation is the point: a scorecard that measures a slightly different
 * search from the product is how the changelog stayed at the top of the
 * rankings while a green suite said retrieval was fine.
 */
export interface Verdict {
  gold: GoldQuestion;
  ranked: string[];
  /** A `best` page took first place — or none was demanded and an `ok` did. */
  first: boolean;
  /** An acceptable page reached the retrieved window. */
  inContext: boolean;
  /** No forbidden page reached the top three. */
  clean: boolean;
  /** Every demanded concept resolved at weight 1. */
  concepts: boolean;
  missingConcepts: string[];
}

export function judge(gold: GoldQuestion, retriever: DocsRetriever, index: DocsIndex): Verdict {
  // No `currentUrl`: the page boost is a real feature, but folding it into the
  // score here would measure the harness rather than the ranking.
  const understanding = understand(gold.question, { api: index.api, currentUrl: "", previous: null });
  const results = retriever.search(gold.question, {
    limit: 6,
    conceptTerms: conceptTerms(understanding.concepts),
    allowHistory: understanding.wantsHistory,
    conceptPages: conceptPages(understanding.concepts),
  });

  const ranked = results.map((result) => result.section.url.split("#")[0]);
  const acceptable = [...(gold.best ?? []), ...(gold.ok ?? [])];
  const named = new Set(understanding.concepts.filter((match) => match.weight === 1).map((match) => match.id));
  const missingConcepts = (gold.concepts ?? []).filter((id) => !named.has(id));

  return {
    gold,
    ranked,
    first: gold.best ? gold.best.includes(ranked[0] ?? "") : acceptable.includes(ranked[0] ?? ""),
    inContext: acceptable.some((page) => ranked.includes(page)),
    clean: !(gold.forbidden ?? []).some((page) => ranked.slice(0, 3).includes(page)),
    concepts: missingConcepts.length === 0,
    missingConcepts,
  };
}

export function score(verdicts: Verdict[]) {
  const rate = (predicate: (verdict: Verdict) => boolean) =>
    verdicts.filter(predicate).length / Math.max(verdicts.length, 1);

  return {
    total: verdicts.length,
    first: rate((verdict) => verdict.first),
    inContext: rate((verdict) => verdict.inContext),
    clean: rate((verdict) => verdict.clean),
    concepts: rate((verdict) => verdict.concepts),
  };
}
