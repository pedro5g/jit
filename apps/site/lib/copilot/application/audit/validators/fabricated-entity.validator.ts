/**
 * Named things the answer introduced that nothing supports — §PART 15.
 *
 * Not a named-entity recogniser, and deliberately not trying to be. What the
 * benchmark actually produced was a two-word proper noun in subject position —
 * "Ajit Jain" — and the rule generalises from the shape rather than from the
 * string: a capitalised multi-word name, not at a sentence boundary, that
 * appears in neither the retrieved evidence nor anywhere in the documentation.
 *
 * The corpus check is what keeps this from firing on legitimate prose. The
 * documentation names TypeScript, Chrome, Vercel and half a dozen competing
 * libraries; an answer mentioning any of them is quoting, not inventing.
 */
import type { AnswerValidator, AuditContext, AuditFinding } from "../../../core/entities/audit";

export const fabricatedEntityValidator: AnswerValidator = {
  name: "fabricated-entity",

  validate({ claims }: AuditContext): AuditFinding[] {
    const invented = claims.filter((claim) => claim.kind === "entity" && !claim.supported);
    if (invented.length === 0) return [];

    const names = [...new Set(invented.flatMap((claim) => claim.subjects))];

    return [
      {
        kind: "fabricated-entity",
        severity: "fatal",
        origin: "grounding_failure",
        detail: `The answer names ${names.join(", ")}, which appears nowhere in the documentation.`,
        offenders: names,
        source: "fabricated-entity",
      },
    ];
  },
};
