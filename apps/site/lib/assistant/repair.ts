import type { ApiSurface } from "./api-surface";
import type { AuditFinding } from "./audit";
import { isSevere } from "./audit";

/**
 * What to say to the model when the audit rejected its answer.
 *
 * Showing the reader a banner that says "this is wrong" is honest, but it is
 * the second-best outcome: they still have to work out what the right answer
 * was. The model is still loaded and the mistake is precisely identified, so
 * the cheap move is to hand the finding back and let it write the answer again.
 *
 * The correction is deliberately narrow. A small model told "you got something
 * wrong, try harder" rewrites everything and usually gets worse; told "you
 * wrote `.notEmpty()`, a string schema has `noEmpty`, `min`, `max`, …" it fixes
 * that one call and leaves the rest of a good answer alone.
 */

/**
 * How many unsourced sentences make an answer worth rewriting rather than
 * merely worth a footnote.
 *
 * One is noise: a framing sentence legitimately shares few words with the
 * documentation. Two or more is the signature of an answer that was produced
 * rather than read — and it was the *only* finding on both of the worst
 * answers reported, which is precisely why nothing was retried. An answer whose
 * every technical claim is unsupported is not a footnote case.
 */
const UNSOURCED_SENTENCES_WORTH_A_RETRY = 2;

/** Findings worth spending another generation on. */
export function isRepairable(finding: AuditFinding): boolean {
  if (finding.kind === "ungrounded-claim") {
    return finding.sentences.length >= UNSOURCED_SENTENCES_WORTH_A_RETRY;
  }

  return isSevere(finding) || finding.kind === "unsupported-number" || finding.kind === "unusable-example";
}

/**
 * How many kinds' worth of method names a correction may carry. Two is enough
 * to cover the schema in hand and the one it is nested in, and short enough
 * that the list stays readable next to the sections.
 */
const KINDS_IN_CORRECTION = 2;

/** Schema kinds a piece of code actually builds, so only their methods are shown. */
function kindsUsed(answer: string, surface: ApiSurface): string[] {
  const kinds: string[] = [];

  for (const kind of ["string", "number", "object", "array", "date"]) {
    if (new RegExp(`JIT\\.${kind}\\s*\\(`).test(answer)) kinds.push(kind);
  }

  return kinds.length > 0 ? kinds.slice(0, KINDS_IN_CORRECTION) : ["string", "object"].filter(() => surface !== null);
}

/**
 * The turn that asks for a corrected answer. Returns null when nothing the
 * audit found is worth another pass.
 */
export function repairTurn(answer: string, findings: AuditFinding[], surface: ApiSurface | null): string | null {
  const repairable = findings.filter(isRepairable);
  if (repairable.length === 0) return null;

  const problems: string[] = [];
  let namesWereInvented = false;

  for (const finding of repairable) {
    if (finding.kind === "invented-api") {
      namesWereInvented = true;
      problems.push(`These names do not exist in jit: ${finding.names.join(", ")}. Do not use them again.`);
    }

    if (finding.kind === "invented-method") {
      namesWereInvented = true;
      problems.push(`These methods do not exist: ${finding.names.join(", ")}. Do not use them again.`);
    }

    if (finding.kind === "invented-cli") {
      problems.push(
        `These commands do not exist: ${finding.names.join(", ")}. The CLI has exactly: jit init, jit generate, jit watch, jit check, jit mcp.`
      );
    }

    if (finding.kind === "contradiction") {
      problems.push(`You contradicted an established fact. The fact is: ${finding.claim}`);
    }

    if (finding.kind === "unsupported-number") {
      problems.push(
        `These figures appear in none of the sections you were given: ${finding.values.join(", ")}. Remove them, or say the sections do not give a number.`
      );
    }

    if (finding.kind === "ungrounded-claim") {
      problems.push(
        `Nothing in the sections supports these sentences, so you invented them: ${finding.sentences
          .map((sentence) => `"${sentence}"`)
          .join(" ")} Replace each one with what the sections actually say, or drop it.`
      );
    }

    if (finding.kind === "unusable-example") {
      problems.push(`Your code example is wrong: ${finding.reason}`);
    }
  }

  // The valid alternatives, but only when a name was the problem: a
  // contradiction is fixed by re-reading the fact, not by a longer list.
  const alternatives: string[] = [];
  if (namesWereInvented && surface) {
    for (const kind of kindsUsed(answer, surface)) {
      alternatives.push(`Every method a ${kind} schema has: ${surface.chainFor(kind).join(", ")}`);
    }
  }

  return [
    "Your previous answer was rejected by an automatic check against the real library.",
    ...problems.map((problem) => `- ${problem}`),
    ...alternatives,
    "",
    "Write the answer again. Keep everything that was correct, fix only what is listed above, and use no name that is not in the API list or the sections.",
  ].join("\n");
}

/**
 * Which of two attempts to show.
 *
 * A retry can come back worse — a small model asked to fix one call sometimes
 * abandons a good explanation — so the attempts are compared rather than the
 * last one trusted. Fewer severe findings wins; on a tie, the earlier answer
 * does, because it was written without a correction crowding its context.
 */
export function betterAttempt<T extends { findings: AuditFinding[] }>(first: T, second: T): T {
  const cost = (attempt: T) =>
    attempt.findings.filter(isSevere).length * 10 + attempt.findings.filter(isRepairable).length;

  return cost(second) < cost(first) ? second : first;
}
