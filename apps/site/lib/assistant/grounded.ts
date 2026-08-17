import { conceptById } from "./graph";
import type { RetrievedSection } from "./types";
import type { Understanding } from "./understanding";

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
  source: string;
  more: string;
}

const COPY: Record<"pt" | "en", Copy> = {
  pt: {
    lead: (subject) => subject,
    how: "Na prática:",
    source: "Fonte:",
    more: "Posso detalhar qualquer um desses pontos.",
  },
  en: {
    lead: (subject) => subject,
    how: "Concretely:",
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
  if (understanding.intent !== "concept" && understanding.intent !== "compare") return false;
  return subjectOf(understanding) !== undefined;
}

export function groundedAnswer(understanding: Understanding, sections: RetrievedSection[]): string | null {
  const node = subjectOf(understanding);
  if (!node?.fact) return null;

  const language = understanding.language;
  const copy = COPY[language];
  const fact = (language === "pt" ? node.factPt : undefined) ?? node.fact;
  const how = (language === "pt" ? node.mechanismsPt : undefined) ?? node.mechanisms ?? [];

  const parts: string[] = [copy.lead(fact)];

  if (how.length > 0) {
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
