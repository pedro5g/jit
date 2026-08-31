import { describe, expect, it } from "vitest";
import type { AuditFinding, AuditResult } from "../core/entities/audit";
import type { FailureKind } from "../core/entities/claim";
import { type AnswerLabel, shadowMetrics } from "../eval/labels";

/**
 * The arithmetic behind §PART 25, tested without a model in sight.
 *
 * These numbers decide whether the audit is ever allowed to block an answer,
 * so getting precision and recall the wrong way round would be the most
 * expensive kind of quiet bug: it would read as "the detectors are ready" when
 * the opposite is true.
 */
const finding = (kind: FailureKind, severity: AuditFinding["severity"] = "fatal"): AuditFinding => ({
  kind,
  severity,
  origin: "model_failure",
  detail: kind,
  offenders: [],
  source: kind,
});

const result = (
  findings: AuditFinding[],
  verdict: AuditResult["grounding"]["verdict"] = "fully-grounded"
): AuditResult => ({
  findings,
  classification: { kinds: findings.map((entry) => entry.kind), origins: [] },
  grounding: { claims: 4, supported: 4, coverage: 1, fatalUnsupported: 0, verdict },
  confidence: { retrieval: 1, grounding: 1, symbols: 1 },
});

const label = (question: string, kinds: FailureKind[], shouldReject: boolean): AnswerLabel => ({
  question,
  runId: "test",
  kinds,
  shouldReject,
});

describe("shadow metrics", () => {
  it("scores a detector against what a reader actually found", () => {
    const metrics = shadowMetrics(
      [
        // Caught it.
        { question: "a", result: result([finding("invented-symbol")]) },
        // Fired on an answer with nothing wrong.
        { question: "b", result: result([finding("invented-symbol")]) },
        // Missed one.
        { question: "c", result: result([]) },
      ],
      [label("a", ["invented-symbol"], true), label("b", [], false), label("c", ["invented-symbol"], true)]
    );

    const symbols = metrics.byKind.find((entry) => entry.kind === "invented-symbol");

    expect(symbols).toMatchObject({ truePositives: 1, falsePositives: 1, falseNegatives: 1 });
    expect(symbols?.precision).toBeCloseTo(0.5);
    expect(symbols?.recall).toBeCloseTo(0.5);
  });

  it("measures a false positive against the answers that deserved delivery", () => {
    // The distinction that matters to a reader: rejecting one good answer out
    // of one good answer is a 100% false-positive rate, however many bad ones
    // were also rejected correctly.
    const metrics = shadowMetrics(
      [
        { question: "good", result: result([finding("wrong-language")]) },
        { question: "bad", result: result([finding("fabricated-history")]) },
        { question: "also-bad", result: result([finding("fabricated-history")]) },
      ],
      [
        label("good", [], false),
        label("bad", ["fabricated-history"], true),
        label("also-bad", ["fabricated-history"], true),
      ]
    );

    expect(metrics.rejection.truePositiveRate).toBe(1);
    expect(metrics.rejection.falsePositiveRate).toBe(1);
    expect(metrics.rejection.falsePositives).toBe(1);
    expect(metrics.rejection.falseNegatives).toBe(0);
    expect(metrics.rejection.precision).toBeCloseTo(2 / 3);
  });

  it("counts an answer let through despite a real failure", () => {
    const metrics = shadowMetrics([{ question: "a", result: result([]) }], [label("a", ["fabricated-entity"], true)]);

    expect(metrics.rejection.truePositiveRate).toBe(0);
    expect(metrics.rejection.falseNegatives).toBe(1);
  });

  it("reads grounding from the verdict rather than from a finding", () => {
    // `substantially-ungrounded` is a property of the whole answer, so a
    // detector scored only on findings would report a recall of zero for the
    // one signal §PART 4 puts in the headline.
    const metrics = shadowMetrics(
      [{ question: "a", result: result([], "substantially-ungrounded") }],
      [label("a", ["substantially-ungrounded"], true)]
    );

    expect(metrics.substantiallyUngroundedRecall).toBe(1);
    expect(metrics.byKind.find((entry) => entry.kind === "substantially-ungrounded")?.recall).toBe(1);
  });

  it("does not call an answer clean when the reader found something in it", () => {
    const metrics = shadowMetrics(
      [
        { question: "a", result: result([]) },
        { question: "b", result: result([]) },
      ],
      [label("a", [], false), label("b", ["unsupported-factual-claim"], false)]
    );

    expect(metrics.fullyGroundedPrecision).toBeCloseTo(0.5);
  });

  it("scores only the answers that were labelled", () => {
    const metrics = shadowMetrics(
      [
        { question: "a", result: result([finding("invented-symbol")]) },
        { question: "unlabelled", result: result([finding("invented-symbol")]) },
      ],
      [label("a", ["invented-symbol"], true)]
    );

    expect(metrics.labelled).toBe(1);
    expect(metrics.byKind.find((entry) => entry.kind === "invented-symbol")?.falsePositives).toBe(0);
  });
});
