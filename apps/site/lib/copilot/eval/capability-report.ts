/** Report for the controlled model-capability experiment. */

import type { ModelCapabilityProfile } from "../core/entities/capability.js";
import type { RunArtifacts } from "./artifacts.js";
import {
  type CapabilityDiagnosis,
  type CapabilityGapDecomposition,
  type CapabilityMeasuredCase,
  type CapabilityMetrics,
  type CapabilityVerdict,
  diagnoseCapabilityCase,
  fullCapabilityGate,
  gapDecomposition,
  humanReviewCases,
  smokeGate,
  summarizeCapability,
} from "./capability.js";

export interface CapabilityReportSection {
  config: "P" | "R" | "X";
  label: string;
  artifacts: RunArtifacts;
  cases: CapabilityMeasuredCase[];
  metrics: CapabilityMetrics;
  deliveredMetrics: CapabilityMetrics;
  profile?: ModelCapabilityProfile;
}

export interface CapabilityReportOptions {
  title?: string;
  caseSet: "smoke" | "full";
  verdict?: CapabilityVerdict | null;
  includeHumanReview?: boolean;
}

const WIDTH = 18;
const LABEL = 34;
const percent = (value: number) => `${(value * 100).toFixed(1)}%`;
const number = (value: number | null) => (value === null ? "-" : String(value));

export function renderCapabilityReport(
  sections: readonly CapabilityReportSection[],
  options: CapabilityReportOptions
): string {
  const lines: string[] = [];
  const out = (line = "") => lines.push(line);
  const sectionFor = (config: string) => sections.find((section) => section.config === config);
  const row = (label: string, value: (section: CapabilityReportSection) => string) =>
    out(`  ${label.padEnd(LABEL)}${sections.map((section) => value(section).padStart(WIDTH)).join("")}`);
  const metric = (value: (metrics: CapabilityMetrics) => number) => (section: CapabilityReportSection) =>
    percent(value(section.config === "X" ? section.deliveredMetrics : section.metrics));
  const rawMetric = (value: (metrics: CapabilityMetrics) => number) => (section: CapabilityReportSection) =>
    percent(value(section.metrics));

  out(`# ${options.title ?? "JIT Copilot capability benchmark"}`);
  out();
  out(`${options.caseSet} set · P perfect context · R real context · X production`);
  out();
  out("```text");
  out(`  ${"".padEnd(LABEL)}${sections.map((section) => section.config.padStart(WIDTH)).join("")}`);
  row("configuration", (section) => section.label.slice(0, WIDTH - 1));
  out();

  out("  primary score (X is delivered; X raw appears below)");
  row(
    "fully grounded",
    metric((value) => value.generation.fullyGrounded)
  );
  row(
    "partially grounded",
    metric((value) => value.generation.partiallyGrounded)
  );
  row(
    "substantially ungrounded",
    metric((value) => value.generation.substantiallyUngrounded)
  );
  row(
    "grounding coverage",
    metric((value) => value.generation.groundingCoverage)
  );
  row(
    "weighted explanation completeness",
    metric((value) => value.weightedExplanationCompleteness)
  );
  row(
    "raw facet coverage",
    metric((value) => value.rawFacetCoverage)
  );
  row(
    "core facet coverage",
    metric((value) => value.coreFacetCoverage)
  );
  row(
    "supporting facet coverage",
    metric((value) => value.supportingFacetCoverage)
  );
  row(
    "optional facet coverage",
    metric((value) => value.optionalFacetCoverage)
  );
  row(
    "causal coherence (proxy)",
    metric((value) => value.causalCoherence)
  );
  row(
    "usable explanation",
    metric((value) => value.usableExplanation)
  );
  out();

  out("  locale breakdown (raw P/R; delivered X)");
  for (const locale of ["pt-BR", "en"] as const) {
    row(`${locale} cases`, (section) => String(section.cases.filter((entry) => entry.case.locale === locale).length));
    row(
      `${locale} weighted completeness`,
      localeMetric(sectionForLocale, locale, (value) => value.weightedExplanationCompleteness)
    );
    row(
      `${locale} core facets`,
      localeMetric(sectionForLocale, locale, (value) => value.coreFacetCoverage)
    );
    row(
      `${locale} grounding`,
      localeMetric(sectionForLocale, locale, (value) => value.generation.groundingCoverage)
    );
    row(
      `${locale} wrong language`,
      localeMetric(sectionForLocale, locale, (value) => value.generation.wrongLanguage)
    );
    row(
      `${locale} usable`,
      localeMetric(sectionForLocale, locale, (value) => value.usableExplanation)
    );
  }
  out();

  out("  quality and hallucination");
  row(
    "specificity",
    metric((value) => value.generation.specificity)
  );
  row(
    "redundancy",
    metric((value) => value.generation.redundancy)
  );
  row(
    "wrong language",
    metric((value) => value.generation.wrongLanguage)
  );
  row(
    "invented symbol",
    metric((value) => value.generation.inventedSymbol)
  );
  row(
    "fabricated entity",
    metric((value) => value.generation.fabricatedEntity)
  );
  row(
    "fabricated history",
    metric((value) => value.generation.fabricatedHistory)
  );
  row(
    "unsupported claim",
    metric((value) => value.generation.unsupportedClaim)
  );
  row(
    "foreign-domain drift",
    metric((value) => value.generation.foreignDomainDrift)
  );
  row(
    "cites source (info only)",
    metric((value) => value.generation.citesSource)
  );
  out();

  out("  raw X and delivery recovery");
  row(
    "weighted completeness (raw)",
    rawMetric((value) => value.weightedExplanationCompleteness)
  );
  row(
    "grounding (raw)",
    rawMetric((value) => value.generation.groundingCoverage)
  );
  row(
    "substantially ungrounded (raw)",
    rawMetric((value) => value.generation.substantiallyUngrounded)
  );
  row(
    "would reject (raw)",
    rawMetric((value) => value.generation.wouldReject)
  );
  row("delivery salvage", (section) => percent(section.metrics.generation.salvageUsed));
  row("delivery fallback", (section) => percent(section.metrics.generation.groundedSynthesisUsed));
  out();

  out("  runtime");
  row("median latency", (section) => `${(section.deliveredMetrics.runtime.medianLatencyMs / 1000).toFixed(2)}s`);
  row("P95 latency", (section) => `${(section.deliveredMetrics.runtime.p95LatencyMs / 1000).toFixed(2)}s`);
  row("median TTFT", (section) => {
    const value = section.deliveredMetrics.runtime.medianTtftMs;
    return value === null ? "-" : `${(value / 1000).toFixed(2)}s`;
  });
  row("tokens/sec", (section) => {
    const value = section.deliveredMetrics.runtime.tokensPerSecond;
    return value === null ? "-" : value.toFixed(1);
  });
  row("prompt tokens", (section) => {
    const value = section.deliveredMetrics.runtime.promptTokens;
    return value === null ? "-" : `${value}${section.deliveredMetrics.runtime.promptTokensEstimated ? "*" : ""}`;
  });
  row("completion tokens", (section) => number(section.deliveredMetrics.runtime.completionTokens));
  out();

  out("  manifest and environment");
  row("model", (section) => section.artifacts.manifest.model.id);
  row("model repo", (section) => section.artifacts.manifest.model.repo?.slice(0, WIDTH - 1) ?? "-");
  row("dtype", (section) => section.artifacts.manifest.model.dtype ?? "-");
  row(
    "inference",
    (section) =>
      `temp=${section.artifacts.manifest.generation.temperature} ${section.artifacts.manifest.generation.greedy ? "greedy" : "sampled"}`
  );
  row("thinking mode", (section) => section.artifacts.manifest.generation.thinking ?? "not recorded");
  row("knowledge hash", (section) => section.artifacts.manifest.knowledge.contentHash.slice(0, 12));
  row(
    "prompt/context version",
    (section) => `v${section.artifacts.manifest.promptVersion}/v${section.artifacts.manifest.contextVersion}`
  );
  row("browser", (section) => section.artifacts.manifest.browser?.userAgent.slice(0, WIDTH - 1) ?? "-");
  row(
    "WebGPU adapter",
    (section) => section.artifacts.manifest.browser?.adapter?.description?.slice(0, WIDTH - 1) ?? "-"
  );
  const profile = sections.find((section) => section.profile)?.profile;
  if (profile) {
    out();
    out("  measured capability profile");
    for (const [name, value] of Object.entries(profile)) out(`  ${name.padEnd(LABEL)}${value}`);
  }
  out("  * prompt tokens estimated when the browser provider did not expose usage");
  out("  * P/R citation, action, tool and navigation findings are shadow-only and excluded from capability score");

  const gaps = buildGaps(sections);
  out();
  out("  P/R/X gap decomposition");
  out(`  Model Ceiling       ${formatGap(gaps.modelCeiling)}`);
  out(`  Context Loss        ${formatGap(gaps.contextLoss)}  (P - R)`);
  out(`  Protocol Loss       ${formatGap(gaps.protocolLoss)}  (R - raw X)`);
  out(`  Delivery Recovery   ${formatGap(gaps.deliveryRecovery)}  (delivered X - raw X)`);

  out();
  out("  diagnostic mapping");
  out("  P ruim → model-capability");
  out("  P bom, R ruim → context-loss");
  out("  P bom, R bom, X ruim → protocol-overload");
  out("  P bom, R bom, X bom → production-success");
  const diagnoses = diagnosesFor(sections);
  for (const [diagnosis, count] of diagnoses) out(`  ${diagnosis.padEnd(24)} ${count}`);

  const p = sectionFor("P");
  if (p) {
    const smoke = smokeGate(p.metrics);
    const full = fullCapabilityGate(p.metrics);
    out();
    out("  capability gates");
    out(`  smoke P: ${smoke.passed ? "PASS" : "FAIL"}${smoke.reasons.length ? ` — ${smoke.reasons.join("; ")}` : ""}`);
    out(`  full P:  ${full.passed ? "PASS" : "FAIL"}${full.reasons.length ? ` — ${full.reasons.join("; ")}` : ""}`);
  }

  out("```");
  out();
  out("## Required interpretation");
  out();
  out("P ruim");
  out("→ MODEL CAPABILITY FAILURE");
  out("P bom / R ruim");
  out("→ CONTEXT / COVERAGE FAILURE");
  out("P bom / R bom / X ruim");
  out("→ PROTOCOL / PRODUCT ORCHESTRATION FAILURE");
  out("P bom / R bom / X bom");
  out("→ TARGET ACHIEVED");
  out();
  out(`## ${options.verdict ?? "VERDICT PENDING — browser run required"}`);
  out();
  out(
    "Capability and runtime verdicts are separate. The latency table measures the observed browser runtime; it does not change the model-capability verdict."
  );

  if (options.includeHumanReview !== false) appendHumanReview(out, sections);
  return lines.join("\n");

  function sectionForLocale(section: CapabilityReportSection, locale: "pt-BR" | "en"): CapabilityMetrics {
    const cases = section.cases.filter((entry) => entry.case.locale === locale);
    const delivered = section.config === "X";
    const selected = delivered
      ? cases.map((entry) => ({
          ...entry,
          measurement: entry.deliveredMeasurement ?? entry.measurement,
          capability: entry.deliveredCapability ?? entry.capability,
        }))
      : cases;
    return summarizeCapability(selected);
  }
}

function localeMetric(
  getMetrics: (section: CapabilityReportSection, locale: "pt-BR" | "en") => CapabilityMetrics,
  locale: "pt-BR" | "en",
  pick: (metrics: CapabilityMetrics) => number
) {
  return (section: CapabilityReportSection) => {
    const cases = section.cases.filter((entry) => entry.case.locale === locale);
    return cases.length === 0 ? "-" : percent(pick(getMetrics(section, locale)));
  };
}

function buildGaps(sections: readonly CapabilityReportSection[]): CapabilityGapDecomposition {
  const p = sections.find((section) => section.config === "P");
  const r = sections.find((section) => section.config === "R");
  const x = sections.find((section) => section.config === "X");
  if (!p || !r || !x) return { modelCeiling: 0, contextLoss: 0, protocolLoss: 0, deliveryRecovery: 0 };
  return gapDecomposition(p.metrics, r.metrics, x.metrics, x.deliveredMetrics);
}

function formatGap(value: number): string {
  const sign = value >= 0 ? "+" : "";
  return `${sign}${(value * 100).toFixed(1)} pp`;
}

function diagnosesFor(sections: readonly CapabilityReportSection[]): Map<CapabilityDiagnosis, number> {
  const p = sections.find((section) => section.config === "P");
  const r = sections.find((section) => section.config === "R");
  const x = sections.find((section) => section.config === "X");
  const result = new Map<CapabilityDiagnosis, number>();
  if (!p || !r || !x) return result;
  const byQuestion = (section: CapabilityReportSection, question: string) =>
    section.cases.find((entry) => entry.case.question === question);
  for (const question of new Set(p.cases.map((entry) => entry.case.question))) {
    const left = byQuestion(p, question);
    const middle = byQuestion(r, question);
    const right = byQuestion(x, question);
    if (!left || !middle || !right) continue;
    const diagnosis = diagnoseCapabilityCase(left, middle, right);
    result.set(diagnosis, (result.get(diagnosis) ?? 0) + 1);
  }
  return result;
}

function appendHumanReview(out: (line?: string) => void, sections: readonly CapabilityReportSection[]) {
  const available = sections.flatMap((section) => section.cases.map((entry) => entry.case));
  const selected = humanReviewCases(available);
  out();
  const ptCount = selected.filter((testCase) => testCase.locale === "pt-BR").length;
  const enCount = selected.filter((testCase) => testCase.locale === "en").length;
  out(`## Human review set (${ptCount} PT-BR / ${enCount} EN available)`);
  out();
  out("These raw outputs are printed for inspection only and do not alter the automatic score.");
  for (const testCase of selected) {
    out();
    out(`### ${testCase.locale} · ${testCase.question}`);
    for (const section of sections) {
      const row = section.cases.find((entry) => entry.case.question === testCase.question);
      if (!row) continue;
      out(`\nCONFIG ${section.config} RAW ANSWER\n${row.rawAnswer}`);
      if (section.config === "X" && row.deliveredAnswer !== row.rawAnswer) {
        out(`\nCONFIG X DELIVERED ANSWER\n${row.deliveredAnswer}`);
      }
    }
  }

  const acceptance = "por que a JIT é tão rápida?";
  out();
  out("## Acceptance case side-by-side");
  out();
  out(`QUESTION\n${acceptance}`);
  for (const section of sections) {
    const context = section.artifacts.contexts.find((record) => record.question === acceptance);
    out();
    out(`ORACLE EVIDENCE (${section.config})`);
    if (context?.oracle) {
      for (const evidence of context.oracle.evidence) {
        out(
          `[${evidence.priority}] ${evidence.knowledgeId} ${evidence.chunkId} ${evidence.routeId}${evidence.anchor ? `#${evidence.anchor}` : ""}`
        );
        out(evidence.content);
      }
    } else if (context) {
      for (const evidence of context.context.evidence) out(`[${evidence.index}] ${evidence.content}`);
    } else {
      out("(not run)");
    }
    const row = section.cases.find((entry) => entry.case.question === acceptance);
    out(`\nCONFIG ${section.config} RAW ANSWER\n${row?.rawAnswer ?? "(not run)"}`);
    if (section.config === "X") out(`\nCONFIG X DELIVERED ANSWER\n${row?.deliveredAnswer ?? "(not run)"}`);
  }
}
