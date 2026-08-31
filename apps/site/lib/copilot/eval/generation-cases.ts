/**
 * The questions the model comparison is run on.
 *
 * A subset, not the full 264. Generation costs seconds per case where
 * retrieval costs milliseconds, and three configurations over the whole set
 * would take hours to answer a question that thirty well-chosen cases answer
 * just as well. What matters is that every category §PART 5 lists is
 * represented, so a regression can be attributed rather than averaged away.
 *
 * Every case is drawn from the hand-written half of the retrieval set, which
 * means the expected symbols and routes have already been checked against the
 * real index — a benchmark whose expectations are wrong measures nothing.
 */
import { HAND_WRITTEN_CASES } from "./cases";
import type { EvalCase, EvalCategory } from "./types";

/** How many of each category the comparison runs. */
const QUOTA: Partial<Record<EvalCategory, number>> = {
  "api-lookup": 5,
  concept: 6,
  navigation: 3,
  "simple-code": 6,
  "complex-code": 3,
  "hallucination-trap": 3,
  negative: 2,
  "follow-up": 2,
  ambiguous: 1,
};

/**
 * Balanced by language as well as by category.
 *
 * §PART 5 asks for Portuguese and English measured separately, and the
 * documentation is English-only — so a Portuguese question exercises the
 * multilingual embedding, the synonym bridge and the model's instruction to
 * reply in the reader's language, all at once. A benchmark that under-samples
 * them hides the failure that matters most to half the readers.
 */
export function generationCases(): EvalCase[] {
  const used = new Map<EvalCategory, number>();
  const selected: EvalCase[] = [];

  // Alternate locales within a category so a quota of five is not five
  // English questions because English ones happen to be listed first.
  const byCategory = new Map<EvalCategory, EvalCase[]>();
  for (const entry of HAND_WRITTEN_CASES) {
    const list = byCategory.get(entry.category) ?? [];
    list.push(entry);
    byCategory.set(entry.category, list);
  }

  for (const [category, cases] of byCategory) {
    const quota = QUOTA[category] ?? 0;
    if (quota === 0) continue;

    const english = cases.filter((entry) => entry.locale === "en");
    const portuguese = cases.filter((entry) => entry.locale === "pt-BR");

    for (let index = 0; index < quota; index++) {
      const pool = index % 2 === 0 ? english : portuguese;
      const fallback = index % 2 === 0 ? portuguese : english;
      const taken = used.get(category) ?? 0;

      const next = pool[Math.floor(index / 2)] ?? fallback[Math.floor(index / 2)];
      if (!next || selected.includes(next)) continue;

      selected.push(next);
      used.set(category, taken + 1);
    }
  }

  return selected;
}
