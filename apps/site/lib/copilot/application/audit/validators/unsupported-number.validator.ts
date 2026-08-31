/**
 * Figures the documentation never states.
 *
 * A number is the one kind of claim a reader acts on without checking: "12x
 * faster than zod" or "under 4 KB" goes into a slide, a pull request
 * description, a decision. It is also the easiest thing for a model to
 * produce, because a benchmark table in its training data looks exactly like
 * the benchmark table in front of it.
 *
 * Only figures with units are checked. A bare `3` in `.min(3)` is an argument,
 * not a claim, and flagging it is how a banner gets ignored.
 */
import type { AnswerValidator, AuditContext, AuditFinding } from "../../../core/entities/audit";

export const unsupportedNumberValidator: AnswerValidator = {
  name: "unsupported-number",

  validate({ claims }: AuditContext): AuditFinding[] {
    const unsupported = claims.filter((claim) => claim.kind === "numeric" && !claim.supported);
    if (unsupported.length === 0) return [];

    const figures = [...new Set(unsupported.flatMap((claim) => claim.subjects))];

    return [
      {
        kind: "unsupported-factual-claim",
        // A footnote, not a block: the answer is still useful with an asterisk
        // on one number, and the reader can see which.
        severity: "warning",
        origin: "grounding_failure",
        detail: `${figures.join(", ")} ${figures.length === 1 ? "does" : "do"} not appear in the documentation this answer was given.`,
        offenders: figures,
        source: "unsupported-number",
      },
    ];
  },
};
