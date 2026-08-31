/**
 * Ground truth for the detectors themselves — §PART 25.
 *
 * Every number the shadow audit reports is a claim about answers, and a claim
 * about answers is only checkable against a reading of them. So a label file
 * records what a careful reader says is actually wrong with each transcript,
 * and the detectors are scored against that rather than against themselves.
 *
 * Two things this deliberately is not. It is not a second model judging the
 * first — the labels are written by hand, once, against saved transcripts, and
 * they stay in the repository where a disputed call can be read and argued
 * with. And it is not a target to tune against: §PART 1 freezes the engine, so
 * a detector that scores badly here is a finding, not an invitation to move
 * the threshold until the number improves.
 *
 * A label answers two questions about one answer: which failures are really in
 * it, and whether a reader was better off not seeing it at all.
 */

import { StrictAuditPolicy } from "../application/audit/audit.service";
import type { AuditResult } from "../core/entities/audit";
import type { FailureKind } from "../core/entities/claim";

export interface AnswerLabel {
  /** The question, which is the key into a run's three streams. */
  question: string;
  /** Which run this was read from, so a label is never silently reused. */
  runId: string;

  /** Failures a careful reader confirms are present in the answer. */
  kinds: FailureKind[];

  /**
   * Whether the reader was better off not seeing this answer.
   *
   * Deliberately separate from `kinds`. An answer can carry a warning-level
   * problem and still be worth reading, and the policy question — reject or
   * not — is what a false positive is actually measured against.
   */
  shouldReject: boolean;

  /** One line, so a disputed call can be re-read rather than re-argued. */
  note?: string;
}

/** A detector's performance on one failure kind. */
export interface KindScore {
  kind: FailureKind;
  truePositives: number;
  falsePositives: number;
  falseNegatives: number;
  /** Of what it flagged, how much was really wrong. */
  precision: number;
  /** Of what was really wrong, how much it flagged. */
  recall: number;
}

export interface ShadowMetrics {
  labelled: number;

  /** Per-kind detection, which is where a bad detector is actually visible. */
  byKind: KindScore[];

  /**
   * The policy-level numbers — §PART 23 asks for exactly these two before a
   * retry is switched on.
   */
  rejection: {
    /** Correctly rejected, of the answers that deserved rejection. */
    truePositiveRate: number;
    /** Wrongly rejected, of the answers that did not. */
    falsePositiveRate: number;
    precision: number;
    /** Answers a reader would have lost to a false positive. */
    falsePositives: number;
    /** Answers a reader would have been shown despite a real failure. */
    falseNegatives: number;
  };

  /** Of the answers called fully grounded, how many really were. */
  fullyGroundedPrecision: number;
  /** Of the answers that really were ungrounded, how many were caught. */
  substantiallyUngroundedRecall: number;
}

export const AUDIT_RELEASE_TARGET = {
  minimumLabels: 100,
  rejectionPrecision: 0.98,
  rejectionRecall: 0.98,
  maximumFalsePositiveRate: 0.02,
} as const;

/** A release gate over human labels, never detector self-scores. */
export function auditReleaseReady(metrics: ShadowMetrics): boolean {
  return (
    metrics.labelled >= AUDIT_RELEASE_TARGET.minimumLabels &&
    metrics.rejection.precision >= AUDIT_RELEASE_TARGET.rejectionPrecision &&
    metrics.rejection.truePositiveRate >= AUDIT_RELEASE_TARGET.rejectionRecall &&
    metrics.rejection.falsePositiveRate <= AUDIT_RELEASE_TARGET.maximumFalsePositiveRate
  );
}

const ratio = (numerator: number, denominator: number) => (denominator === 0 ? 1 : numerator / denominator);

/**
 * Every kind worth scoring, including the ones nothing detected.
 *
 * A kind with no findings and no labels still belongs in the table: its
 * absence is a result, and a detector that never fires is indistinguishable
 * from a missing row unless the row is printed.
 */
export const SCORED_KINDS: FailureKind[] = [
  "invented-symbol",
  "fabricated-entity",
  "fabricated-history",
  "unsupported-factual-claim",
  "foreign-domain-drift",
  "wrong-language",
  "generation-degeneration",
  "invalid-example",
  "substantially-ungrounded",
];

export interface ScoredAnswer {
  question: string;
  result: AuditResult;
}

export function shadowMetrics(answers: readonly ScoredAnswer[], labels: readonly AnswerLabel[]): ShadowMetrics {
  const byQuestion = new Map(labels.map((label) => [label.question, label]));
  const pairs = answers
    .map((answer) => ({ answer, label: byQuestion.get(answer.question) }))
    .filter((pair): pair is { answer: ScoredAnswer; label: AnswerLabel } => pair.label !== undefined);

  const detected = (result: AuditResult, kind: FailureKind) => {
    // The grounding verdict is a property of the whole answer rather than a
    // finding, so an ungrounded answer is "detected" by either route.
    if (kind === "substantially-ungrounded") return result.grounding.verdict === "substantially-ungrounded";
    return result.findings.some((finding) => finding.kind === kind);
  };

  const byKind = SCORED_KINDS.map((kind) => {
    const truePositives = pairs.filter(
      (pair) => detected(pair.answer.result, kind) && pair.label.kinds.includes(kind)
    ).length;
    const falsePositives = pairs.filter(
      (pair) => detected(pair.answer.result, kind) && !pair.label.kinds.includes(kind)
    ).length;
    const falseNegatives = pairs.filter(
      (pair) => !detected(pair.answer.result, kind) && pair.label.kinds.includes(kind)
    ).length;

    return {
      kind,
      truePositives,
      falsePositives,
      falseNegatives,
      precision: ratio(truePositives, truePositives + falsePositives),
      recall: ratio(truePositives, truePositives + falseNegatives),
    };
  });

  const policy = new StrictAuditPolicy();
  const rejects = (result: AuditResult) => policy.shouldReject(result);

  const shouldHave = pairs.filter((pair) => pair.label.shouldReject);
  const shouldNot = pairs.filter((pair) => !pair.label.shouldReject);
  const rejectedCorrectly = shouldHave.filter((pair) => rejects(pair.answer.result)).length;
  const rejectedWrongly = shouldNot.filter((pair) => rejects(pair.answer.result)).length;

  const calledClean = pairs.filter(
    (pair) => pair.answer.result.grounding.verdict === "fully-grounded" && pair.answer.result.findings.length === 0
  );
  const reallyUngrounded = pairs.filter((pair) => pair.label.kinds.includes("substantially-ungrounded"));

  return {
    labelled: pairs.length,
    byKind,
    rejection: {
      truePositiveRate: ratio(rejectedCorrectly, shouldHave.length),
      // Not `1 - precision`: the denominator is the answers that deserved to
      // be delivered, which is what a reader loses to an over-eager policy.
      falsePositiveRate: shouldNot.length === 0 ? 0 : rejectedWrongly / shouldNot.length,
      precision: ratio(rejectedCorrectly, rejectedCorrectly + rejectedWrongly),
      falsePositives: rejectedWrongly,
      falseNegatives: shouldHave.length - rejectedCorrectly,
    },
    fullyGroundedPrecision: ratio(
      calledClean.filter((pair) => !pair.label.shouldReject && pair.label.kinds.length === 0).length,
      calledClean.length
    ),
    substantiallyUngroundedRecall: ratio(
      reallyUngrounded.filter((pair) => pair.answer.result.grounding.verdict === "substantially-ungrounded").length,
      reallyUngrounded.length
    ),
  };
}
