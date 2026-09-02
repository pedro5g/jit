/**
 * The last gate before an answer is shown — and only the gate, never the lock.
 *
 * Three responsibilities, kept apart on purpose:
 *
 *   a validator detects one kind of problem;
 *   this service aggregates and classifies;
 *   an `AuditPolicy` decides what the product does about it.
 *
 * The old audit collapsed all three into one function with an `isSevere()`
 * switch, which meant changing the product's tolerance during a rollout risked
 * changing what was detected at all. Splitting them is what makes shadow mode
 * possible: the same detectors run over saved transcripts with a policy that
 * rejects nothing, and the false-positive rate is measurable before a single
 * reader is affected.
 *
 * What §101 asks for is worth restating precisely, because it is easy to
 * misread: the target is not that the model stops hallucinating. It is that a
 * hallucination is detected before the reader sees it.
 */

import { MIN_USABLE_SCORE } from "../../config/retrieval";
import type { AnswerValidator, AuditContext, AuditFinding, AuditPolicy, AuditResult } from "../../core/entities/audit";
import type { FailureKind, FailureOrigin, GroundingClaim } from "../../core/entities/claim";
import type { ModelContext } from "../../core/entities/model-context";
import type { KnowledgeRepository, SymbolRepository } from "../../core/repositories";
import type { Locale } from "../../core/value-objects/locale";
import { analyseClaims } from "./claims";
import { degenerationValidator } from "./validators/degeneration.validator";
import { fabricatedEntityValidator } from "./validators/fabricated-entity.validator";
import { fabricatedHistoryValidator } from "./validators/fabricated-history.validator";
import { foreignDomainValidator } from "./validators/foreign-domain.validator";
import { groundingValidator, groundingVerdict } from "./validators/grounding.validator";
import { inventedSymbolValidator } from "./validators/invented-symbol.validator";
import { sourceCitationValidator } from "./validators/source-citation.validator";
import { unsupportedClaimValidator } from "./validators/unsupported-claim.validator";
import { unsupportedNumberValidator } from "./validators/unsupported-number.validator";
import { wrongLanguageValidator } from "./validators/wrong-language.validator";

/**
 * Order matters for exactly one of these.
 *
 * A degenerated answer is not a claim to fact-check — running the rest over a
 * looped generation produces eight findings that all describe the same broken
 * output, and the reader gets a wall of banners instead of "the model broke,
 * try again". So it runs first and stops the pipeline.
 */
export const DEFAULT_VALIDATORS: AnswerValidator[] = [
  degenerationValidator,
  inventedSymbolValidator,
  fabricatedHistoryValidator,
  fabricatedEntityValidator,
  foreignDomainValidator,
  wrongLanguageValidator,
  unsupportedNumberValidator,
  unsupportedClaimValidator,
  sourceCitationValidator,
  groundingValidator,
];

export interface AuditInput {
  question: string;
  answer: string;
  locale: Locale;
  sourceOnly?: boolean;
  modelContext: ModelContext;
  symbols: SymbolRepository;
  knowledge: KnowledgeRepository;
  corpusKnows: (term: string) => boolean;
  /** How well retrieval did, for the confidence numbers. */
  topScore?: number;
  /** How many independent retrievers agreed on the best result. */
  agreement?: number;
}

export class AuditService {
  constructor(private readonly validators: AnswerValidator[] = DEFAULT_VALIDATORS) {}

  run(input: AuditInput): AuditResult {
    const analysis = analyseClaims({
      answer: input.answer,
      context: input.modelContext,
      hasSymbol: (name) => input.symbols.findByPath(name) !== undefined,
      corpusKnows: input.corpusKnows,
    });

    const context: AuditContext = {
      question: input.question,
      answer: input.answer,
      locale: input.locale,
      ...(input.sourceOnly ? { sourceOnly: true } : {}),
      modelContext: input.modelContext,
      symbols: input.symbols,
      knowledge: input.knowledge,
      corpusKnows: input.corpusKnows,
      claims: analysis.claims,
    };

    const findings: AuditFinding[] = [];

    for (const validator of this.validators) {
      findings.push(...validator.validate(context));
      if (validator.name === "degeneration" && findings.length > 0) break;
    }

    const grounding = groundingVerdict(analysis.claims);

    return {
      findings,
      classification: classify(findings, grounding.verdict),
      grounding: {
        claims: analysis.claims.length,
        supported: grounding.supported,
        coverage: Math.round(grounding.coverage * 100) / 100,
        fatalUnsupported: analysis.fatalUnsupported,
        verdict: grounding.verdict,
      },
      confidence: confidence(input, findings, analysis.claims, grounding.coverage),
    };
  }
}

function classify(findings: readonly AuditFinding[], verdict: AuditResult["grounding"]["verdict"]) {
  const kinds = new Set<FailureKind>(findings.map((finding) => finding.kind));
  const origins = new Set<FailureOrigin>(findings.map((finding) => finding.origin));

  // `fully-grounded` is a classification, not the absence of one — so the
  // report shows a single distribution rather than a failure count beside a
  // separately-computed success rate that may disagree with it.
  if (verdict === "fully-grounded" && findings.length === 0) kinds.add("fully-grounded");

  return { kinds: [...kinds], origins: [...origins] };
}

function confidence(
  input: AuditInput,
  findings: readonly AuditFinding[],
  claims: readonly GroundingClaim[],
  coverage: number
): AuditResult["confidence"] {
  /**
   * Retrieval quality, on the scale fused scores actually occupy.
   *
   * RRF scores are small and bounded — a chunk every retriever ranked first
   * lands around 0.08 — so the floor is normalized against a multiple of the
   * usability threshold rather than against 1, which every real score would
   * fall far below.
   */
  const retrieval = Math.min(1, (input.topScore ?? 0) / (MIN_USABLE_SCORE * 4));
  const agreement = Math.min(1, (input.agreement ?? 0) / 3);
  const exact = input.modelContext.symbols.length > 0 ? 1 : 0;

  const nameProblems = findings.filter((finding) => finding.kind === "invented-symbol").length;
  const apiClaims = claims.filter((claim) => claim.kind === "api");

  return {
    retrieval: round(retrieval * 0.6 + agreement * 0.25 + exact * 0.15),
    grounding: round(coverage),
    symbols: round(nameProblems > 0 ? Math.max(0, 1 - nameProblems * 0.5) : apiClaims.length > 0 ? 1 : 0.8),
  };
}

function round(value: number): number {
  return Math.round(Math.min(1, Math.max(0, value)) * 100) / 100;
}

/**
 * §PART 23: the first policy, and it is deliberately blunt.
 *
 * A fatal finding rejects. Warnings annotate. Nothing else — no score
 * arithmetic, no tolerance band — because a policy with parameters is a policy
 * nobody can predict, and the first thing needed is a baseline whose
 * false-positive rate means something.
 *
 * Retry stays off until the shadow run says the detectors are trustworthy.
 * Regenerating on a false positive costs the reader thirty seconds and gives
 * them a worse answer.
 */
export class StrictAuditPolicy implements AuditPolicy {
  constructor(private readonly retryEnabled = false) {}

  shouldReject(result: AuditResult): boolean {
    return result.findings.some(isBlockingFinding);
  }

  shouldRetry(result: AuditResult): boolean {
    return this.retryEnabled && this.shouldReject(result);
  }
}

/**
 * Detects everything, blocks nothing — §PART 24.
 *
 * What a shadow run uses. The findings are recorded and reported; the answer
 * is delivered untouched, so a detector can be measured against real traffic
 * before it is trusted with it.
 */
export class ShadowAuditPolicy implements AuditPolicy {
  shouldReject(): boolean {
    return false;
  }

  shouldRetry(): boolean {
    return false;
  }
}

/**
 * What to tell the model on the one retry it eventually gets.
 *
 * "Your answer was wrong" produces a differently wrong answer;
 * "`JIT.compare.deepEqual` does not exist, `JIT.compare` has changed, diff,
 * equal, hash" produces a corrected one.
 */
export function retryInstruction(findings: readonly AuditFinding[], symbols: SymbolRepository): string {
  const lines: string[] = ["Your previous answer was rejected. Fix exactly these problems and answer again."];

  for (const finding of findings.filter(isBlockingFinding)) {
    lines.push(`- ${finding.detail}`);

    for (const offender of finding.offenders.slice(0, 4)) {
      const alternative = symbols.search(offender.replace(/^[.]|\(\)$/g, ""), 1)[0];
      if (alternative) lines.push(`  Use ${alternative.symbol.path} instead of ${offender}.`);
    }
  }

  lines.push("Use only names that appear in the API surface, and only facts written in the documentation above.");
  return lines.join("\n");
}

function isBlockingFinding(finding: AuditFinding): boolean {
  return (
    finding.severity === "fatal" ||
    finding.kind === "unsupported-factual-claim" ||
    finding.kind === "foreign-domain-drift"
  );
}
