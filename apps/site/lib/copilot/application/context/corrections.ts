/**
 * Names the question wrote that do not exist, and what does.
 *
 * A small model corrects a name it half-remembers far more reliably than it
 * refrains from inventing one. When the question writes
 * `JIT.compare.deepEqual`, telling it that `JIT.compare` holds `changed, diff,
 * equal, hash` is worth more than the entire surface listing — it is the
 * answer, stated before the model has a chance to guess.
 *
 * Structured rather than pre-formatted, because the audit reads the same
 * corrections afterwards to check whether the model took them.
 */
import type { ContextCorrection } from "../../core/entities/model-context";
import type { SymbolRepository } from "../../core/repositories";
import { scanJitExpressions } from "../../core/value-objects/jit-expression";

export function findCorrections(question: string, repository: SymbolRepository): ContextCorrection[] {
  const corrections: ContextCorrection[] = [];
  const seen = new Set<string>();

  const note = (written: string, parentPath: string) => {
    if (seen.has(written)) return;
    seen.add(written);

    /**
     * The parent's real members beat a fuzzy suggestion, when there is one.
     *
     * `deepEqual` is not a prefix or a substring of `equal`, so the near-miss
     * search finds nothing and the correction degrades to "that does not
     * exist" — true, and useless to a model that now has to guess again. But
     * `JIT.compare` does exist, and listing what it actually holds turns the
     * correction into the answer.
     *
     * Capped, because a schema builder has forty chain methods and forty names
     * is not a correction, it is a second API listing.
     */
    const parent = repository.findByPath(parentPath);
    const members = parent
      ? repository
          .related(parent.id)
          .filter((child) => child.parent === parent.id)
          .map((child) => child.name)
          .sort()
      : [];

    if (members.length > 0 && members.length <= 14) {
      corrections.push({ written, suggestion: `${parent?.path} has: ${members.join(", ")}` });
      return;
    }

    const leaf = written.split(/[.(]/).filter(Boolean).pop() ?? written;
    const [best] = repository.search(leaf, 1);

    corrections.push({
      written,
      suggestion: best ? `the closest real name is ${best.symbol.path}` : "there is no close match",
    });
  };

  /**
   * The expression parser, not a regex.
   *
   * `JIT.string().notEmpty()` is the shape that matters most here — an
   * invented *method* on a real factory — and a regex stops at the first
   * parenthesis, so it saw `JIT.string`, found it real, and said nothing. That
   * is the exact case the audit exists for, and the correction is worth far
   * more before generation than a rejection after it.
   */
  for (const expression of scanJitExpressions(question)) {
    const root = `JIT.${expression.root}`;
    if (!repository.findByPath(root)) {
      note(root, "JIT");
      continue;
    }

    if (expression.member && !repository.findByPath(`${root}.${expression.member}`)) {
      note(`${root}.${expression.member}`, root);
      continue;
    }

    for (const call of expression.calls) {
      // A chain method is scoped to the factory the chain started from, which
      // is the one place the schema kind is known for certain.
      if (!repository.findByPath(`${root}.${call}`)) note(`${root}().${call}()`, root);
    }
  }

  return corrections;
}
