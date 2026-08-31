/**
 * Claims about who made the library, when, and why — §PART 16.
 *
 * The failure that motivated the whole claim model. Asked "por que a jit
 * existe?", the light model answered:
 *
 *   "Ajit Jain, o criador da JIT, desenvolveu uma estrutura de código
 *    interativo simples e eficiente para otimizar a execução de aplicativos
 *    web."
 *
 * A fabricated person, a fabricated authorship, a fabricated motivation — and
 * every name-based check passed it, because it never mentions an API. It is
 * fluent, confident, and the kind of thing a reader repeats in a meeting.
 *
 * The documentation contains no origin story at all, which is what makes this
 * detectable rather than merely suspicious: any claim of this shape is
 * unsupported unless the evidence itself uses the vocabulary of authorship.
 */
import type { AnswerValidator, AuditContext, AuditFinding } from "../../../core/entities/audit";

export const fabricatedHistoryValidator: AnswerValidator = {
  name: "fabricated-history",

  validate({ claims }: AuditContext): AuditFinding[] {
    const fabricated = claims.filter((claim) => claim.kind === "historical" && !claim.supported);
    if (fabricated.length === 0) return [];

    return [
      {
        kind: "fabricated-history",
        severity: "fatal",
        origin: "grounding_failure",
        detail:
          fabricated.length === 1
            ? "The answer states who created the library, or when, and the documentation says nothing about either."
            : `${fabricated.length} sentences state origins the documentation does not contain.`,
        offenders: fabricated.map((claim) => claim.text),
        source: "fabricated-history",
      },
    ];
  },
};
