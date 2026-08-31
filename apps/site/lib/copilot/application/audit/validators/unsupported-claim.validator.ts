/**
 * Technical and behavioural assertions nothing in the context supports —
 * §PART 17.
 *
 * The honest scope, stated first: absence of evidence is not falsity. A
 * correct answer routinely reaches for vocabulary from a page retrieval did
 * not return, and marking that wrong would make the banner noise. So this
 * marks `unsupported`, not `false`, and its severity is a warning rather than
 * fatal — an answer with one unsupported technical sentence is still worth
 * reading, with an asterisk on that sentence.
 *
 * What makes it useful anyway is the claim model underneath: a sentence is
 * only checked if it *asserts* something about how the library works or what
 * it supports, so "here is how to compile the check" is not a claim and "jit
 * stores schemas in a global registry" is.
 */
import type { AnswerValidator, AuditContext, AuditFinding } from "../../../core/entities/audit";

export const unsupportedClaimValidator: AnswerValidator = {
  name: "unsupported-claim",

  validate({ claims }: AuditContext): AuditFinding[] {
    const unsupported = claims.filter(
      (claim) => !claim.supported && (claim.kind === "technical" || claim.kind === "behavior")
    );

    if (unsupported.length === 0) return [];

    return [
      {
        kind: "unsupported-factual-claim",
        severity: "warning",
        origin: "grounding_failure",
        detail:
          unsupported.length === 1
            ? "One sentence states something about the library that the documentation shown here does not."
            : `${unsupported.length} sentences state things the documentation shown here does not.`,
        offenders: unsupported.map((claim) => claim.text),
        source: "unsupported-claim",
      },
    ];
  },
};
