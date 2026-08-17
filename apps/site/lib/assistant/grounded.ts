import { conceptById } from "./graph";
import type { RetrievedSection } from "./types";
import type { Understanding } from "./understanding";

/**
 * Code that is known to work, for when the model's own could not be made to.
 *
 * Both sources are executed by the test suite on every run — the recipes in
 * `solutions.ts` and the demonstration each concept carries — so an example
 * taken from here has already been run against the real library today. It is
 * the floor under a generated example, not a replacement for one: it answers
 * the subject rather than the reader's exact question.
 */
export function verifiedExampleFor(understanding: Understanding): string | null {
  const recipe = understanding.solutions[0];
  if (recipe) return recipe.example;

  for (const match of understanding.concepts) {
    if (match.weight !== 1) continue;

    const example = conceptById(match.id)?.example;
    if (example) return example;
  }

  return null;
}

/**
 * The answer written from what is already known to be true.
 *
 * The models here are small — 0.8B by default — and there is a class of
 * question where asking them to write anything is pure downside: the correct
 * answer already exists, verified by hand, in the concept graph, and the model
 * can only paraphrase it worse. Asked why jit is fast, one produced "compila o
 * código em JavaScript diretamente na memória da memória RAM" and an example
 * calling `User.query('SELECT * FROM users')`, having been handed six sections
 * that all say the right thing.
 *
 * So when the audit rejects every attempt, the ghost stops trying to have the
 * model say it and says it itself. This is not a degraded answer — for a
 * "what" or "why" question it is the better one, because every sentence in it
 * was written deliberately and checked against the library.
 *
 * It is deliberately not the first choice: a model that passes the audit
 * answers *this reader's* question, adapts to their wording, and follows up.
 * This is the floor, not the ceiling.
 */

interface Copy {
  lead: (subject: string) => string;
  how: string;
  example: string;
  source: string;
  more: string;
}

const COPY: Record<"pt" | "en", Copy> = {
  pt: {
    lead: (subject) => subject,
    how: "Na prática:",
    example: "Na prática, em código:",
    source: "Fonte:",
    more: "Posso detalhar qualquer um desses pontos.",
  },
  en: {
    lead: (subject) => subject,
    how: "Concretely:",
    example: "In code:",
    source: "Source:",
    more: "I can go deeper on any of these.",
  },
};

/** The concept this answer is about: named directly, and carrying a fact. */
function subjectOf(understanding: Understanding) {
  for (const match of understanding.concepts) {
    if (match.weight !== 1) continue;

    const node = conceptById(match.id);
    if (node?.fact) return node;
  }

  return undefined;
}

/**
 * Whether a verified answer is worth more than a generated one.
 *
 * Only for questions that want an explanation. A how-to needs code shaped to
 * what the reader is building, and a troubleshooting question needs their
 * error — neither is something a fixed paragraph can do, so those fall through
 * to the ordinary failure path rather than getting a confident non-answer.
 */
export function canAnswerFromGround(understanding: Understanding): boolean {
  const subject = subjectOf(understanding);
  if (!subject) return false;

  if (understanding.intent === "concept" || understanding.intent === "compare") return true;

  // "pode me mostrar um exemplo de uso?" is a how-to, and a fixed paragraph
  // cannot answer most of those — but it can answer this one, because every
  // concept carries a runnable demonstration that the test suite executes.
  // Without it the reader got a JSON envelope and a hundred lines of push().
  return (understanding.intent === "howto" || understanding.intent === "api") && Boolean(subject.example);
}

export function groundedAnswer(understanding: Understanding, sections: RetrievedSection[]): string | null {
  const node = subjectOf(understanding);
  if (!node?.fact) return null;

  const language = understanding.language;
  const copy = COPY[language];
  const fact = (language === "pt" ? node.factPt : undefined) ?? node.fact;
  const how = (language === "pt" ? node.mechanismsPt : undefined) ?? node.mechanisms ?? [];

  const parts: string[] = [copy.lead(fact)];

  // Asked for an example, lead with the example — the mechanisms are the
  // answer to "why", not to "show me".
  const wantsCode = understanding.intent === "howto" || understanding.intent === "api";

  if (wantsCode && node.example) {
    parts.push(`${copy.example}\n\n\`\`\`ts\n${node.example}\n\`\`\``);
  }

  if (how.length > 0 && !wantsCode) {
    parts.push([copy.how, ...how.map((line) => `- ${line}`)].join("\n"));
  }

  // A citation the reader can check, taken from what retrieval actually
  // returned rather than from the concept's own page — the section in front of
  // them is the one that backs this up.
  const best = sections[0]?.section ?? null;
  if (best) parts.push(`${copy.source} ${best.breadcrumb || best.heading} — ${best.url}`);
  else if (node.page) parts.push(`${copy.source} ${node.page}`);

  parts.push(copy.more);

  return parts.join("\n\n");
}
