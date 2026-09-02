/**
 * The A/B/C report, rendered once and used by both halves of the benchmark.
 *
 * The generation run prints it and the re-score run rebuilds it from saved
 * transcripts, and they must agree — a table that says one thing while the
 * model answers and another thing a week later is not a measurement. Sharing
 * the renderer is what makes that agreement structural rather than a habit.
 *
 * §PART 3's rule shapes every row below: one line per behaviour, no aggregate
 * that can hide one. The single number that hid a fabricated founder behind
 * "invented API: 0.0%" is exactly what this format exists to prevent.
 */

import type { RunManifest } from "./artifacts";
import type { GenerationMetrics, MeasuredCase } from "./detectors";
import type { ShadowMetrics } from "./labels";

/**
 * Stated in every report, because a table travels further than its caveats.
 *
 * §PART 2 is explicit: the headless light tier is not the browser's light
 * tier. Qwen3.5-0.8B does not load under `onnxruntime-node` — its graph uses
 * an operator the runtime does not register — so the headless floor is a
 * *smaller* model. Calling that number "the 0.8B" would be a misleading
 * comparison, and it is the kind that gets quoted.
 */
export const TIER_NOTE = [
  "0.5B  headless floor — smaller than the browser's light tier, so a lower bound on it, never an estimate of it.",
  "1.7B  headless strong baseline — what a larger model does on the same evidence.",
  "0.8B  the browser's actual light tier, measured only by the WebGPU run — never by this table (§PART 26).",
];

/**
 * The browser report's own note, because it answers a different question.
 *
 * §PART 28: the two tables measure different runtimes on different hardware,
 * and a single table would invite exactly the averaging the failure taxonomy
 * exists to prevent. Neither may be quoted as the other.
 */
export const BROWSER_NOTE = [
  "This is the runtime a reader is in: Chrome, WebGPU, the tier the product ships.",
  "Its rows may not be merged with the headless table — different runtime, different hardware.",
  "Latency and tokens/sec are one machine's, named in the manifest. Grounding is the portable half.",
];

export interface ReportSection {
  /** `A`, `B`, `C`. */
  config: string;
  /** What that configuration was, in words. */
  label: string;
  manifest?: RunManifest | null;
  cases: MeasuredCase[];
  metrics: GenerationMetrics;
  /** Present once the transcripts have been labelled — §PART 25. */
  shadow?: ShadowMetrics | null;
}

const LABEL_WIDTH = 30;
const COLUMN_WIDTH = 14;

const percent = (value: number) => `${(value * 100).toFixed(1)}%`;

export interface ReportOptions {
  title: string;
  cases: number;
  /** The line under the title. A browser run is neither greedy-on-CPU nor node. */
  runtime?: string;
  /** How to read the tiers, when the default note is about another table. */
  notes?: readonly string[];
}

export function renderReport(sections: readonly ReportSection[], options: ReportOptions): string {
  const lines: string[] = [];
  const out = (text = "") => lines.push(text);

  const row = (label: string, pick: (section: ReportSection) => string) =>
    out(`  ${label.padEnd(LABEL_WIDTH)}${sections.map((section) => pick(section).padStart(COLUMN_WIDTH)).join("")}`);

  const share = (pick: (metrics: GenerationMetrics) => number) => (section: ReportSection) =>
    percent(pick(section.metrics));

  out(`# ${options.title}`);
  out();
  out(`${options.cases} cases per configuration · ${options.runtime ?? "greedy decoding · CPU"}`);
  out();
  out("```text");

  out(`  ${"".padEnd(LABEL_WIDTH)}${sections.map((section) => section.config.padStart(COLUMN_WIDTH)).join("")}`);
  row("", (section) => section.label.slice(0, COLUMN_WIDTH - 1));
  out();

  /**
   * The headline, and §PART 4 is specific about which two numbers it is.
   *
   * Not "invented API", which was 0.0% for the answer that invented a person,
   * a date and a motivation. Grounding is the axis that puts that answer where
   * it belongs, so it goes first and everything else qualifies it.
   */
  row(
    "fully grounded",
    share((metrics) => metrics.fullyGrounded)
  );
  row(
    "substantially ungrounded",
    share((metrics) => metrics.substantiallyUngrounded)
  );
  out();

  row("knowledge hash", (section) => section.manifest?.knowledge.contentHash.slice(0, 8) ?? "-");
  row("prompt / context version", (section) =>
    section.manifest ? `v${section.manifest.promptVersion}/v${section.manifest.contextVersion}` : "-"
  );
  row("answered", (section) => `${section.metrics.answered}/${section.metrics.cases}`);
  out();

  out("  grounding");
  row(
    "  partially grounded",
    share((metrics) => metrics.partiallyGrounded)
  );
  row(
    "  coverage",
    share((metrics) => metrics.groundingCoverage)
  );
  row(
    "  explanation completeness",
    share((metrics) => metrics.explanationCompleteness)
  );
  row(
    "  facet coverage",
    share((metrics) => metrics.facetCoverage)
  );
  row(
    "  specificity",
    share((metrics) => metrics.specificity)
  );
  row(
    "  redundancy",
    share((metrics) => metrics.redundancy)
  );
  row("  claims / answer", (section) => section.metrics.averageClaims.toFixed(1));
  out();

  out("  hallucination");
  row(
    "  invented API",
    share((metrics) => metrics.inventedApi)
  );
  row(
    "  invented method",
    share((metrics) => metrics.inventedMethod)
  );
  row(
    "  fabricated entity",
    share((metrics) => metrics.fabricatedEntity)
  );
  row(
    "  fabricated history",
    share((metrics) => metrics.fabricatedHistory)
  );
  row(
    "  unsupported technical claim",
    share((metrics) => metrics.unsupportedClaim)
  );
  row(
    "  foreign-domain drift",
    share((metrics) => metrics.foreignDomainDrift)
  );
  out();

  out("  usefulness");
  /**
   * "Factual correctness" is on §PART 3's list and is not on this table.
   *
   * Nothing here can decide whether a true-sounding sentence is true; the only
   * thing that could is a judge model, and a judge is the one component whose
   * verdicts nothing else could check. So the row is named, left unmeasured,
   * and the three checkable proxies under it are what the report actually
   * claims — a blank that says what is missing beats a number that implies it
   * was measured.
   */
  row("  factual correctness", () => "not measured");
  row(
    "  names expected API",
    share((metrics) => metrics.symbolAccuracy)
  );
  row("  usable code", (section) =>
    section.metrics.showedCode === 0 ? "-" : `${percent(section.metrics.usableCode)} of ${section.metrics.showedCode}`
  );
  row("  correct navigation", (section) =>
    section.metrics.offeredNavigation === 0
      ? "-"
      : `${percent(section.metrics.correctNavigation)} of ${section.metrics.offeredNavigation}`
  );
  row(
    "  cites a source",
    share((metrics) => metrics.citesSource)
  );
  out();

  out("  delivery");
  row(
    "  wrong language",
    share((metrics) => metrics.wrongLanguage)
  );
  row(
    "  degeneration",
    share((metrics) => metrics.degenerated)
  );
  row(
    "  would be rejected",
    share((metrics) => metrics.wouldReject)
  );
  row(
    "  raw model rejected",
    share((metrics) => metrics.rawWouldReject)
  );
  row(
    "  deterministic salvage",
    share((metrics) => metrics.salvageUsed)
  );
  row(
    "  grounded fallback",
    share((metrics) => metrics.groundedSynthesisUsed)
  );
  out();

  out("  cost");
  row("  answer length", (section) => `${section.metrics.averageCharacters}ch`);
  row("  median latency", (section) => `${(section.metrics.medianLatencyMs / 1000).toFixed(1)}s`);
  // "-" where the runtime cannot observe it, which is the honest value: a
  // streamed answer's first token and an unstreamed one are not comparable.
  row("  median first token", (section) =>
    section.metrics.medianTtftMs === null ? "-" : `${(section.metrics.medianTtftMs / 1000).toFixed(2)}s`
  );
  row("  tokens/sec", (section) => section.metrics.tokensPerSecond.toFixed(1));
  row("  query embedding", (section) => `${section.metrics.queryEmbeddingMs.toFixed(1)}ms`);
  row("  exact vector scan", (section) => `${section.metrics.vectorScanMs.toFixed(2)}ms`);
  row("  top-K finalize", (section) => `${section.metrics.vectorTopKMs.toFixed(2)}ms`);
  row("  peak heap", (section) =>
    section.manifest?.browser?.peakMemoryMb ? `${Math.round(section.manifest.browser.peakMemoryMb)}mb` : "-"
  );

  // ------------------------------------------------------------------ origin
  out();
  out("  failure origin (answers affected)");
  for (const origin of [
    "retrieval_failure",
    "context_failure",
    "model_failure",
    "grounding_failure",
    "language_failure",
    "generation_failure",
  ]) {
    row(`  ${origin.replace("_failure", "")}`, (section) => String(section.metrics.byOrigin[origin] ?? 0));
  }

  // ---------------------------------------------------------------- category
  const categories = [...new Set(sections.flatMap((section) => section.cases.map((entry) => entry.case.category)))];

  out();
  out("  rejected by a strict policy, by category");
  for (const category of categories.sort()) {
    row(`  ${category}`, (section) => {
      const subset = section.cases.filter((entry) => entry.case.category === category);
      if (subset.length === 0) return "-";
      const bad = subset.filter((entry) =>
        entry.measurement.audit.findings.some((finding) => finding.severity === "fatal")
      ).length;
      return `${bad}/${subset.length}`;
    });
  }

  out();
  out("  wrong language, by locale");
  for (const locale of ["en", "pt-BR"]) {
    row(`  ${locale}`, (section) => {
      const subset = section.cases.filter((entry) => entry.case.locale === locale);
      if (subset.length === 0) return "-";
      const wrong = subset.filter((entry) =>
        entry.measurement.audit.findings.some((finding) => finding.kind === "wrong-language")
      ).length;
      return `${wrong}/${subset.length}`;
    });
  }

  // ------------------------------------------------------------------ shadow
  if (sections.some((section) => section.shadow)) {
    out();
    out("  shadow audit against hand-read labels (§PART 25)");
    row("  labelled answers", (section) => String(section.shadow?.labelled ?? 0));
    row("  rejection TPR", (section) => (section.shadow ? percent(section.shadow.rejection.truePositiveRate) : "-"));
    row("  rejection FPR", (section) => (section.shadow ? percent(section.shadow.rejection.falsePositiveRate) : "-"));
    row("  fatal precision", (section) => (section.shadow ? percent(section.shadow.rejection.precision) : "-"));
    row("  answers lost (FP)", (section) => String(section.shadow?.rejection.falsePositives ?? 0));
    row("  answers let through (FN)", (section) => String(section.shadow?.rejection.falseNegatives ?? 0));
    row("  fully-grounded precision", (section) =>
      section.shadow ? percent(section.shadow.fullyGroundedPrecision) : "-"
    );

    out();
    out("  detector recall / precision, by kind");
    for (const kind of sections.find((section) => section.shadow)?.shadow?.byKind.map((entry) => entry.kind) ?? []) {
      row(`  ${kind}`, (section) => {
        const score = section.shadow?.byKind.find((entry) => entry.kind === kind);
        if (!score) return "-";
        if (score.truePositives + score.falsePositives + score.falseNegatives === 0) return "none";
        return `${percent(score.recall)}/${percent(score.precision)}`;
      });
    }
  }

  /**
   * The machine, under the table rather than inside it — §PART 27.
   *
   * A GPU description does not fit a column, and a truncated one ("AMD Radeon
   * 78") is worse than none: latency and tokens/sec mean nothing without the
   * device that produced them, so the device is printed whole or not at all.
   */
  const machines = sections.filter((section) => section.manifest?.browser);

  if (machines.length > 0) {
    out();
    out("  machine");
    for (const section of machines) {
      const browser = section.manifest?.browser;
      const device = browser?.deviceClass;

      const parts = [
        browser?.adapter?.description || browser?.adapter?.vendor,
        device?.cores ? `${device.cores} cores` : null,
        device?.memoryGb ? `${device.memoryGb} GB` : null,
        browser?.userAgent,
      ].filter(Boolean);

      out(`  ${section.config.padEnd(LABEL_WIDTH - 2)}${parts.join(" · ")}`);
    }
  }

  out("```");
  out();

  out("## How to read the tiers");
  out();
  for (const note of options.notes ?? TIER_NOTE) out(`- ${note}`);
  out();

  return lines.join("\n");
}
