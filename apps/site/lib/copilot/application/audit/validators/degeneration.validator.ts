/**
 * A generation that came apart, rather than an answer that is wrong.
 *
 * Handed a question and thin evidence, a small model does one of two things:
 * it emits the shape of a training example — a raw `{"question": …}` envelope
 * — or it falls into a loop, repeating a line with the noun changed until it
 * runs out of tokens. Both were observed in a single answer.
 *
 * Neither is a claim to fact-check. The output is simply broken, and no amount
 * of grounding analysis says anything useful about it — so this runs first and
 * the service stops there.
 */
import type { AnswerValidator, AuditContext, AuditFinding } from "../../../core/entities/audit";

/** A line repeated this many times is a loop, not emphasis. */
const REPEATS_THAT_ARE_A_LOOP = 4;

function detect(answer: string): string | null {
  const trimmed = answer.trim();

  if (/^[{[]/.test(trimmed) && /"(?:question|answer|code|response|output)"\s*:/.test(trimmed.slice(0, 400))) {
    return "it is raw machine output rather than a reply — a JSON envelope instead of an answer.";
  }

  // A repeated declaration is the clearest signal there is: real code does not
  // declare the same const twice, and a loop always does it eventually.
  const seen = new Set<string>();
  for (const match of answer.matchAll(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=/g)) {
    if (seen.has(match[1]))
      return `it repeats itself — \`${match[1]}\` is declared more than once, so the generation looped.`;
    seen.add(match[1]);
  }

  const counts = new Map<string, number>();
  for (const line of answer.split("\n")) {
    const trimmedLine = line.trim();
    if (trimmedLine.length > 12) counts.set(trimmedLine, (counts.get(trimmedLine) ?? 0) + 1);
  }

  for (const count of counts.values()) {
    if (count >= REPEATS_THAT_ARE_A_LOOP) return "it repeats the same line over and over, so the generation looped.";
  }

  if ((answer.match(/```/g) ?? []).length % 2 === 1) {
    return "it stops in the middle of a code block, so the answer is incomplete.";
  }

  return null;
}

export const degenerationValidator: AnswerValidator = {
  name: "degeneration",

  validate({ answer }: AuditContext): AuditFinding[] {
    const problem = detect(answer);
    if (!problem) return [];

    return [
      {
        kind: "generation-degeneration",
        severity: "fatal",
        origin: "generation_failure",
        detail: problem,
        offenders: [],
        source: "degeneration",
      },
    ];
  },
};
