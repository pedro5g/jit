/**
 * Counting tokens without a tokenizer.
 *
 * The real count depends on which model is loaded, and the model is not loaded
 * when the context is being assembled — that is the whole point of assembling
 * it first. So this estimates, and the estimate only has to be good enough to
 * tell 900 tokens from 2,400, which is the only distinction §38's budget makes.
 *
 * Four characters per token is the standard approximation for English prose.
 * Two corrections matter here and both push the same way: code is denser in
 * punctuation than prose, and Portuguese is slightly denser in accented
 * characters that cost a token of their own in most BPE vocabularies. Both
 * make the true count higher than the naive estimate, so the estimate leans
 * high — running under budget costs a little context, running over it costs a
 * truncated answer.
 */

const CHARS_PER_TOKEN = 4;

/** Punctuation-dense text costs more tokens per character than prose. */
const CODE_PENALTY = 1.35;

export function estimateTokens(text: string): number {
  if (!text) return 0;

  const fenced = [...text.matchAll(/```[\s\S]*?```/g)].reduce((sum, match) => sum + match[0].length, 0);
  const prose = text.length - fenced;

  return Math.ceil((prose + fenced * CODE_PENALTY) / CHARS_PER_TOKEN);
}

/**
 * Fits sources into a budget by dropping whole ones, never by cutting.
 *
 * A passage cut mid-sentence is worse than an absent one: the model reads the
 * fragment as complete and answers from half a rule. And a cut code fence is
 * worse still — it leaves an unterminated block that the renderer then has to
 * repair, or the model copies as if it ran.
 *
 * The first source is always kept even when it exceeds the budget on its own.
 * A context with nothing in it produces an answer with nothing behind it,
 * which is a worse failure than a long prompt.
 */
export function fitToBudget<T>(items: readonly T[], sizeOf: (item: T, index: number) => number, budget: number): T[] {
  const kept: T[] = [];
  let used = 0;

  for (const [index, item] of items.entries()) {
    const size = sizeOf(item, index);
    if (kept.length > 0 && used + size > budget) continue;

    kept.push(item);
    used += size;
  }

  return kept;
}
