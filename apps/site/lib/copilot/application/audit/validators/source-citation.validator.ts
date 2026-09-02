/**
 * Explanations must leave a deterministic path back to the evidence they use.
 *
 * Vocabulary overlap is deliberately only a detector signal: it cannot prove
 * that a fluent model sentence is entailed by a passage. Requiring the model
 * to cite numbered evidence for explanations gives the audit a second,
 * inspectable boundary and prevents uncited synthesis from being presented as
 * grounded prose. Source-only fallbacks are exempt because they already carry
 * their citations and are checked again by the same audit.
 */
import type { AnswerValidator, AuditContext, AuditFinding } from "../../../core/entities/audit";

const CITATION = /\[\d+\]/;

export const sourceCitationValidator: AnswerValidator = {
  name: "source-citation",

  validate({ answer, claims, modelContext, sourceOnly }: AuditContext): AuditFinding[] {
    if (
      sourceOnly ||
      (modelContext.answerMode !== "explain" && modelContext.answerMode !== "deep-explain") ||
      claims.length === 0 ||
      CITATION.test(answer)
    )
      return [];

    return [
      {
        kind: "missing-source-citation",
        severity: "fatal",
        origin: "grounding_failure",
        detail: "An explanation must cite at least one numbered documentation source.",
        offenders: [],
        source: "source-citation",
      },
    ];
  },
};
