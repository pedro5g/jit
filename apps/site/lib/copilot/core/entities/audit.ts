import type { KnowledgeRepository, SymbolRepository } from "../repositories";
import type { Locale } from "../value-objects/locale";
import type { ClaimSeverity, FailureKind, FailureOrigin, GroundingClaim } from "./claim";
import type { ModelContext } from "./model-context";

/**
 * What can be wrong with an answer, named precisely enough to act on.
 *
 * Severity and kind are separate on purpose, and so is origin. A finding says
 * *what* is wrong, *how badly*, and *where it came from* — and only the first
 * is the validator's business. Whether a fatal finding rejects the answer is a
 * policy question, decided elsewhere, by code that knows nothing about how any
 * particular validator works.
 *
 * That separation is what the old audit lacked. `isSevere()` was a function
 * over finding kinds, which meant changing the product's tolerance meant
 * editing the detector — and every experiment with the threshold risked
 * changing what was detected at all.
 */
export interface AuditFinding {
  kind: FailureKind;
  severity: ClaimSeverity;
  /** Where in the pipeline this went wrong, for the benchmark's breakdown. */
  origin: FailureOrigin;
  /** One sentence, addressed to the reader. */
  detail: string;
  /** The exact strings at fault, for the banner and the retry prompt. */
  offenders: string[];
  /** The validator that produced it, so a false positive can be traced. */
  source: string;
}

/**
 * Everything a validator is allowed to look at — §PART 13.
 *
 * Passed explicitly rather than reached for. A validator that reads global
 * state cannot be run over a saved transcript, and running over saved
 * transcripts is the entire point of shadow mode: a new detector has to be
 * measurable against answers that were generated an hour ago by a model that
 * is no longer loaded.
 */
export interface AuditContext {
  question: string;
  answer: string;
  locale: Locale;

  /**
   * The response is a deterministic arrangement of excerpts already present
   * in `modelContext`, not model-authored prose. The audit still runs, but
   * language detection must not reject an English source excerpt shown to a
   * Portuguese reader.
   */
  sourceOnly?: boolean;

  modelContext: ModelContext;

  symbols: SymbolRepository;
  knowledge: KnowledgeRepository;

  /** Whether the documentation uses a word anywhere, not just in the context. */
  corpusKnows: (term: string) => boolean;

  /**
   * The answer's claims, analysed once and shared.
   *
   * Several validators need the decomposition and it is the most expensive
   * thing in the pipeline; computing it per validator would triple the cost of
   * a shadow run over a thousand transcripts.
   */
  claims: readonly GroundingClaim[];
}

/**
 * §PART 12: one responsibility each.
 *
 * The old audit was a single 600-line function, and the cost was not elegance
 * — it was that no check could be tested, tuned or disabled without touching
 * the others. A validator here is a pure function of the context, so the test
 * for "does it catch a fabricated founder" is three lines and involves no
 * model at all.
 */
export interface AnswerValidator {
  readonly name: string;
  validate(context: AuditContext): AuditFinding[];
}

export interface AuditResult {
  findings: AuditFinding[];
  /** Every kind that applies, including `fully-grounded` when nothing is wrong. */
  classification: { kinds: FailureKind[]; origins: FailureOrigin[] };

  grounding: {
    claims: number;
    supported: number;
    /** Share of claims with evidence behind them. */
    coverage: number;
    fatalUnsupported: number;
    verdict: "fully-grounded" | "partially-grounded" | "substantially-ungrounded";
  };

  /**
   * §59: computed from what is known, never from what the model claims.
   *
   * A model's stated confidence is worth nothing here — it is exactly as sure
   * about `JIT.compare.deepEqual` as about `JIT.compare.equal`. These come
   * from evidence instead.
   */
  confidence: { retrieval: number; grounding: number; symbols: number };
}

/**
 * §PART 22: detection is not policy.
 *
 * A validator says what it found. This decides what the product does about
 * it — and the two change for completely different reasons. Tightening the
 * product's tolerance during a rollout should not touch a single detector, and
 * a new detector should not silently change what gets rejected.
 */
export interface AuditPolicy {
  shouldReject(result: AuditResult): boolean;
  shouldRetry(result: AuditResult): boolean;
}
