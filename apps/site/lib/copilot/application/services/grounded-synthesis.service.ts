import type { AuditResult } from "../../core/entities/audit";
import type { ModelContext } from "../../core/entities/model-context";

/**
 * Deterministic last resort over selected evidence.
 *
 * It never invents connective facts: headings identify the aspects and short
 * excerpts remain visibly attributed to their source. The excerpts are kept
 * in the source language; callers mark the result as `sourceOnly` for audit so
 * that a Portuguese answer is not rejected merely because its verified quote
 * is English.
 */
export class GroundedSynthesisService {
  synthesize(context: ModelContext): string {
    // A migration/history passage may intentionally quote an API that no
    // longer exists. It is valid documentation, but repeating that quote as
    // the last-resort answer would make the API audit report it as a new API.
    // Prefer current evidence; retain the quoted material only when it is all
    // the corpus has for the question.
    const currentEvidence = context.evidence.filter((item) => !item.showsRemovedApis);
    const available = currentEvidence.length > 0 ? currentEvidence : context.evidence;
    const evidence = available.slice(0, context.answerMode === "deep-explain" ? 5 : 3);
    if (evidence.length === 0) {
      return context.locale === "pt-BR"
        ? "A documentação atual não contém evidência suficiente para responder."
        : "The current documentation does not contain enough evidence to answer.";
    }

    const intro =
      context.locale === "pt-BR"
        ? "A documentação fundamenta a resposta nestes aspectos:"
        : "The documentation grounds the answer in these aspects:";
    const items = evidence.map((item) => {
      const excerpt = sourceExcerpt(item.content);
      return `- ${item.section}: ${excerpt} [${item.index}]`;
    });
    return [intro, ...items].join("\n\n");
  }

  /** Removes only sentences that the claim analyser mapped deterministically to unsupported claims. */
  salvage(answer: string, audit: AuditResult): string | null {
    const unsupported = audit.grounding.claims === 0 ? [] : audit.findings.flatMap((finding) => finding.offenders);
    const claimTexts = new Set(
      audit.findings
        .filter((finding) => finding.kind === "unsupported-factual-claim")
        .flatMap((finding) => finding.offenders)
        .map(normalize)
    );
    const sentences = answer.split(/(?<=[.!?])\s+|\n+/).filter(Boolean);
    const kept = sentences.filter((sentence) => {
      const normalized = normalize(sentence);
      if ([...claimTexts].some((claim) => claim.length > 10 && normalized.includes(claim))) return false;
      return !unsupported.some((offender) => offender.length > 3 && normalized.includes(normalize(offender)));
    });
    const text = kept.join(" ").trim();
    return kept.length > 0 && text.length >= 40 && kept.length < sentences.length ? text : null;
  }
}

function sourceExcerpt(content: string): string {
  const blocks = content
    .replace(/```[\s\S]*?```/g, "\n")
    .split(/\n\s*\n/)
    .map((block) => block.replace(/\s+/g, " ").trim())
    .filter((block) => block.length > 0)
    .filter((block) => !/^\|?\s*:?-{3,}/.test(block))
    .filter((block) => !/^(?:pnpm|npm|yarn|bun)\s+/.test(block));

  const prose = blocks.filter((block) => !block.startsWith("- ") && !block.startsWith("* "));
  const bullets = blocks.filter((block) => block.startsWith("- ") || block.startsWith("* "));
  const chosen = [...prose.slice(0, 2), ...bullets.slice(0, 4)];
  const excerpt = (chosen.length > 0 ? chosen : blocks).join(" ");
  return excerpt.length > 760 ? `${excerpt.slice(0, 757)}…` : excerpt;
}

function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}.]+/gu, " ")
    .trim();
}
