/**
 * The aggregate grounding verdict — §PART 20.
 *
 * Every other validator reports one kind of problem. This one reports the
 * shape of the answer as a whole: how much of what it asserts traces back to
 * what it was shown.
 *
 * Deliberately not a sentence count. The heuristic it replaces — three
 * unsupported sentences is bad, two is acceptable — scored "Ajit Jain, o
 * criador da JIT" as a one, because it *is* one sentence. Coverage over
 * classified claims is the axis that puts a fabricated origin story where it
 * belongs while leaving a lightly-paraphrased explanation alone.
 */
import type { AnswerValidator, AuditContext, AuditFinding } from "../../../core/entities/audit";

/** Below this share of supported claims, an answer is not built on evidence. */
const SUBSTANTIALLY_UNGROUNDED = 0.5;
/** At or above this, every meaningful assertion traced back. */
const FULLY_GROUNDED = 0.9;

export function groundingVerdict(claims: readonly { supported: boolean }[]) {
  if (claims.length === 0) return { coverage: 1, verdict: "fully-grounded" as const, supported: 0 };

  const supported = claims.filter((claim) => claim.supported).length;
  const coverage = supported / claims.length;

  return {
    coverage,
    supported,
    verdict:
      coverage >= FULLY_GROUNDED
        ? ("fully-grounded" as const)
        : coverage < SUBSTANTIALLY_UNGROUNDED
          ? ("substantially-ungrounded" as const)
          : ("partially-grounded" as const),
  };
}

export const groundingValidator: AnswerValidator = {
  name: "grounding",

  validate({ claims }: AuditContext): AuditFinding[] {
    const { coverage, verdict } = groundingVerdict(claims);
    if (verdict !== "substantially-ungrounded") return [];

    const unsupported = claims.filter((claim) => !claim.supported);

    return [
      {
        kind: "substantially-ungrounded",
        // Fatal on its own: more than half of what the answer asserts has
        // nothing behind it, which is a different library being described.
        severity: "fatal",
        origin: "grounding_failure",
        detail: `Only ${Math.round(coverage * 100)}% of what this answer states traces back to the documentation it was given.`,
        offenders: unsupported.slice(0, 5).map((claim) => claim.text),
        source: "grounding",
      },
    ];
  },
};
