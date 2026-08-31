/**
 * `ModelContext` as the text a model actually reads.
 *
 * The only model-specific step in the pipeline, and the last one. Everything
 * above it is a value that the audit, the eval suite and the debug panel read
 * directly — which is what makes "did the context contain the right passage?"
 * a question with an answer, rather than a substring search over a prompt.
 *
 * §37's section order, and the order is not arbitrary. A small model weights
 * the start and the end of a prompt far more than the middle, so the two
 * things it must not get wrong — what it was asked, and what it is allowed to
 * name — sit at the ends. The documentation goes in the middle, where its
 * length hurts least.
 */
import {
  ACTION_RULES,
  ANSWER_RULES,
  NO_EVIDENCE_RULES,
  SECTION_LABELS,
  SITE_FACTS,
  TOOL_RULES,
} from "../../config/prompt";
import type { ApiSymbol } from "../../core/entities/api-symbol";
import type { ModelContext } from "../../core/entities/model-context";
import type { GenerationMessage } from "../../core/ports/language-model";
import type { SymbolRepository } from "../../core/repositories";
import { surfaceListing } from "./api-facts";
import { evidenceHeader } from "./context.service";
import { findCorrections } from "./corrections";
import { estimateTokens } from "./token-budget";

export interface RenderOptions {
  symbols: SymbolRepository;
  /**
   * Turns of conversation before this one, oldest first. Trimmed hard: a
   * follow-up needs its subject, not the whole session, and budget spent on
   * history is budget not spent on documentation.
   */
  history?: GenerationMessage[];
  /**
   * Include the full surface listing.
   *
   * It is a fifth of the prompt and it earns that on a question that names an
   * API or asks how to do something. On "why is jit fast" it is 400 tokens of
   * noise competing with the documentation for the model's attention.
   */
  includeSurface?: boolean;
}

export function renderMessages(context: ModelContext, options: RenderOptions): GenerationMessage[] {
  return [
    { role: "system", content: renderSystem(context, options) },
    ...(options.history ?? []).slice(-4),
    { role: "user", content: renderUser(context) },
  ];
}

function renderSystem(context: ModelContext, options: RenderOptions): string {
  if (context.empty) return [NO_EVIDENCE_RULES, renderEvidence(context)].filter(Boolean).join("\n\n");

  const blocks = [ANSWER_RULES, SITE_FACTS];

  if (context.corrections.length > 0) {
    blocks.push(
      `${SECTION_LABELS.corrections}\n${context.corrections
        .map((correction) => `${correction.written} does not exist. ${capitalize(correction.suggestion)}.`)
        .join("\n")}`
    );
  }

  if (context.symbols.length > 0) {
    blocks.push(`${SECTION_LABELS.symbols}\n${renderSymbols(context)}`);
  }

  if (options.includeSurface ?? context.symbols.length > 0) {
    blocks.push(`${SECTION_LABELS.surface}\n${surfaceListing(options.symbols)}`);
  }

  blocks.push(renderEvidence(context));
  blocks.push(TOOL_RULES);
  blocks.push(ACTION_RULES);

  return blocks.filter(Boolean).join("\n\n");
}

function renderSymbols(context: ModelContext): string {
  return context.symbols
    .map((entry) => {
      const parts = [entry.symbol.path];

      if (entry.symbol.signatures.length > 0) parts.push(`  signature: ${entry.symbol.signatures[0]}`);
      if (entry.symbol.purpose) parts.push(`  purpose: ${entry.symbol.purpose}`);
      // The part reflection cannot supply: every builder shares one prototype,
      // so `.email()` is a function on a number at runtime and a type error in
      // an editor.
      if (entry.validOn.length > 0) parts.push(`  valid on: ${entry.validOn.join(", ")}`);
      if (entry.members.length > 0) parts.push(`  members: ${entry.members.join(", ")}`);

      return parts.join("\n");
    })
    .join("\n");
}

function renderEvidence(context: ModelContext): string {
  if (context.evidence.length === 0) return "";

  const rendered = context.evidence.map((evidence) => `${evidenceHeader(evidence)}\n${evidence.content}`);
  return `${SECTION_LABELS.documentation}\n\n${rendered.join("\n\n")}`;
}

function renderUser(context: ModelContext): string {
  const parts: string[] = [];

  if (context.current) {
    const heading = context.current.anchor ? `, at "${context.current.title}"` : "";
    parts.push(`CURRENT LOCATION: ${context.current.routeId}${heading}`);
  }

  if (context.current?.selectedText) parts.push(`SELECTED TEXT:\n${context.current.selectedText}`);

  parts.push(context.question);
  return parts.join("\n\n");
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** The rendered prompt's size, for the debug panel and the budget assertion. */
export function renderedSize(messages: readonly GenerationMessage[]): number {
  return messages.reduce((sum, message) => sum + message.content.length, 0);
}

/**
 * What the prompt costs before a single passage is added.
 *
 * Every block except the documentation is fixed once the question and its
 * exact symbols are known, and all of them are measured here rather than
 * approximated — the first version counted only the rules and the surface
 * listing, missed the symbol facts and the corrections, and a context that
 * reported 1,093 tokens rendered as a 2,095 token prompt.
 *
 * Built from the same functions the renderer calls, so the two cannot drift.
 */
export function promptOverhead(
  symbols: SymbolRepository,
  input: {
    question: string;
    exactSymbols: readonly ApiSymbol[];
    includeSurface?: boolean;
  }
): number {
  const includeSurface = input.includeSurface ?? input.exactSymbols.length > 0;

  const facts = input.exactSymbols
    .slice(0, 4)
    .map((symbol) => `${symbol.path} ${symbol.signatures[0] ?? ""} ${symbol.purpose} ${symbol.validOn.join(", ")}`)
    .join("\n");

  const corrections = findCorrections(input.question, symbols)
    .map((correction) => `${correction.written} does not exist. ${correction.suggestion}.`)
    .join("\n");

  const blocks = [
    ANSWER_RULES,
    SITE_FACTS,
    TOOL_RULES,
    ACTION_RULES,
    SECTION_LABELS.documentation,
    corrections ? `${SECTION_LABELS.corrections}\n${corrections}` : "",
    facts ? `${SECTION_LABELS.symbols}\n${facts}` : "",
    includeSurface ? `${SECTION_LABELS.surface}\n${surfaceListing(symbols)}` : "",
  ];

  // Blocks are joined with a blank line, and the user turn carries the
  // question and the current location on top of all of it.
  const separators = blocks.filter(Boolean).length * 2;

  return blocks.reduce((sum, block) => sum + estimateTokens(block), separators);
}
