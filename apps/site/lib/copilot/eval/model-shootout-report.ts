import type { ModelCapabilityProfile } from "../core/entities/capability.js";
import { capabilityCases, fullCapabilityGate, smokeGate, summarizeCapability } from "./capability.js";
import type { CapabilityReportSection } from "./capability-report.js";

export interface ShootoutCandidateIdentity {
  id: string;
  label: string;
  provider: string;
  model?: string;
  family?: string;
  revision?: string;
  dtype?: string;
  parameterCount?: number;
  approximateBytes?: number;
}

export interface ShootoutCandidateResult {
  candidate: ShootoutCandidateIdentity;
  sections: readonly CapabilityReportSection[];
  profile?: ModelCapabilityProfile;
  availability?: string;
}

export type ShootoutVerdict =
  | "VERDICT A — Chrome LanguageModel is the ideal primary runtime."
  | "VERDICT B — A downloadable tiny model is sufficient and preferable."
  | "VERDICT C — Hybrid strategy is ideal: Chrome primary + downloadable fallback."
  | "VERDICT D — No sub-1B candidate satisfies quality. Proceed to 1–2B qualification."
  | "VERDICT PENDING — qualification is incomplete or the runtime is unavailable.";

const pct = (value: number) => `${(value * 100).toFixed(1)}%`;
const seconds = (value: number | null | undefined) =>
  value === null || value === undefined ? "N/A" : `${(value / 1000).toFixed(2)}s`;

function pSection(candidate: ShootoutCandidateResult): CapabilityReportSection | undefined {
  const section = candidate.sections.find((entry) => entry.config === "P");
  return section && section.cases.length > 0 ? section : undefined;
}

function smokeMetrics(section: CapabilityReportSection) {
  const smokeQuestions = new Set(capabilityCases("smoke").map((testCase) => testCase.question));
  const rows = section.cases.filter((row) => smokeQuestions.has(row.case.question));
  return rows.length > 0 ? summarizeCapability(rows) : section.metrics;
}

function gateSummary(candidate: ShootoutCandidateResult) {
  const p = pSection(candidate);
  if (!p) return { smoke: null, full: null };
  const smoke = smokeGate(smokeMetrics(p));
  const full = p.cases.length >= capabilityCases("full").length ? fullCapabilityGate(p.metrics) : null;
  return { smoke, full };
}

export function chooseShootoutVerdict(candidates: readonly ShootoutCandidateResult[]): ShootoutVerdict {
  const qualified = candidates.filter((candidate) => gateSummary(candidate).full?.passed === true);
  const chrome = qualified.some((candidate) => candidate.candidate.provider === "chrome-language-model");
  const downloadable = qualified.some((candidate) => candidate.candidate.provider === "transformers-webgpu");
  if (chrome && downloadable) return "VERDICT C — Hybrid strategy is ideal: Chrome primary + downloadable fallback.";
  if (chrome) return "VERDICT A — Chrome LanguageModel is the ideal primary runtime.";
  if (downloadable) return "VERDICT B — A downloadable tiny model is sufficient and preferable.";

  const incomplete = candidates.some((candidate) => {
    const p = pSection(candidate);
    return candidate.candidate.provider === "chrome-language-model"
      ? candidate.availability !== "unsupported" && !p
      : !p || p.cases.length < capabilityCases("full").length;
  });
  return incomplete
    ? "VERDICT PENDING — qualification is incomplete or the runtime is unavailable."
    : "VERDICT D — No sub-1B candidate satisfies quality. Proceed to 1–2B qualification.";
}

/** Lexicographic efficiency selection after, and only after, the full quality gate. */
export function selectEfficiencyWinner(candidates: readonly ShootoutCandidateResult[]): ShootoutCandidateResult | null {
  const eligible = candidates.filter((candidate) => gateSummary(candidate).full?.passed === true);
  return (
    [...eligible].sort((left, right) => {
      const leftP = pSection(left);
      const rightP = pSection(right);
      const leftMetrics = leftP?.metrics;
      const rightMetrics = rightP?.metrics;
      if (!leftMetrics || !rightMetrics) return 0;
      const availability = (candidate: ShootoutCandidateResult) =>
        candidate.availability === "ready" || candidate.availability === "available" ? 1 : 0;
      return (
        rightMetrics.generation.groundingCoverage - leftMetrics.generation.groundingCoverage ||
        leftMetrics.generation.substantiallyUngrounded - rightMetrics.generation.substantiallyUngrounded ||
        rightMetrics.weightedExplanationCompleteness - leftMetrics.weightedExplanationCompleteness ||
        rightMetrics.usableExplanation - leftMetrics.usableExplanation ||
        leftMetrics.runtime.medianLatencyMs - rightMetrics.runtime.medianLatencyMs ||
        (leftMetrics.runtime.medianTtftMs ?? Number.POSITIVE_INFINITY) -
          (rightMetrics.runtime.medianTtftMs ?? Number.POSITIVE_INFINITY) ||
        availability(right) - availability(left) ||
        (leftP?.artifacts.manifest.browser?.peakMemoryMb ?? Number.POSITIVE_INFINITY) -
          (rightP?.artifacts.manifest.browser?.peakMemoryMb ?? Number.POSITIVE_INFINITY) ||
        (left.candidate.approximateBytes ?? Number.POSITIVE_INFINITY) -
          (right.candidate.approximateBytes ?? Number.POSITIVE_INFINITY)
      );
    })[0] ?? null
  );
}

export function selectDownloadableFallback(
  candidates: readonly ShootoutCandidateResult[]
): ShootoutCandidateResult | null {
  return selectEfficiencyWinner(
    candidates.filter((candidate) => candidate.candidate.provider === "transformers-webgpu")
  );
}

export function renderModelShootoutReport(input: {
  candidates: readonly ShootoutCandidateResult[];
  benchmarkVersion: string;
  testedCommit?: string;
  datasetVersion?: number;
  knowledgeHash?: string;
  generatedAt?: string;
  groundingCalibration?: { before: number; after: number; reason: string };
}): string {
  const lines: string[] = [];
  const out = (line = "") => lines.push(line);
  const verdict = chooseShootoutVerdict(input.candidates);
  const winner = selectEfficiencyWinner(input.candidates);
  const fallback = selectDownloadableFallback(input.candidates);
  const date = input.generatedAt ?? new Date().toISOString();

  out("# JIT Copilot model/runtime shootout");
  out();
  out(`Generated: ${date}`);
  out(`Tested commit: ${input.testedCommit ?? "N/A"}`);
  out(`Benchmark version: ${input.benchmarkVersion}`);
  out(`Dataset version: ${input.datasetVersion ?? "N/A"}`);
  out(`Knowledge hash: ${input.knowledgeHash ?? "N/A"}`);
  out();
  out(
    "Config P is the authority: verified oracle evidence → minimal synthesis prompt → candidate → raw answer → shadow measurement."
  );
  out("Retrieval, citations, actions, tools, retry, salvage and grounded fallback are excluded from P.");
  out();

  out("## Main qualification table");
  out();
  out("| Candidate | Params | Runtime | Dtype | Smoke | Full P | Grounded | Complete | TTFT | tok/s | Size |");
  out("| --- | ---: | --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: |");
  for (const candidate of input.candidates) {
    const p = pSection(candidate);
    const gates = gateSummary(candidate);
    const metrics = p?.metrics;
    const runtime = p?.artifacts.manifest.runtime;
    out(
      `| ${candidate.candidate.label} | ${formatParams(candidate.candidate)} | ${candidate.candidate.provider} | ${candidate.candidate.dtype ?? "N/A"} | ${formatSmoke(candidate, gates.smoke)} | ${formatGate(gates.full)} | ${metrics ? pct(metrics.generation.groundingCoverage) : "N/A"} | ${metrics ? pct(metrics.weightedExplanationCompleteness) : "N/A"} | ${metrics ? seconds(metrics.runtime.medianTtftMs) : "N/A"} | ${metrics?.runtime.tokensPerSecond === null || metrics === undefined ? "N/A" : metrics.runtime.tokensPerSecond.toFixed(1)} | ${formatSize(candidate, runtime?.downloadBytes)} |`
    );
  }

  out();
  out("## Runtime availability");
  out();
  out("| Candidate | Status | Detail |");
  out("| --- | --- | --- |");
  for (const candidate of input.candidates) {
    const manifest = pSection(candidate)?.artifacts.manifest;
    out(
      `| ${candidate.candidate.label} | ${candidate.availability ?? manifest?.runtime.compatibility ?? "not-recorded"} | ${manifest?.runtime.availabilityDetail ?? "N/A"} |`
    );
  }

  out();
  out("## PT/EN and question-profile breakdown (raw P)");
  out();
  out("This prevents a broad-concept average from hiding a language or question-family failure.");
  out();
  out("| Candidate | Slice | Cases | Core | Weighted | Grounding | Causal | Wrong language | Usable |");
  out("| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |");
  for (const candidate of input.candidates) {
    const p = pSection(candidate);
    if (!p) {
      out(`| ${candidate.candidate.label} | all | N/A | N/A | N/A | N/A | N/A | N/A | N/A |`);
      continue;
    }
    const slices = [
      ["PT-BR", p.cases.filter((row) => row.case.locale === "pt-BR")],
      ["EN", p.cases.filter((row) => row.case.locale === "en")],
      ...[...new Set(p.cases.map((row) => row.case.category))].map(
        (category) => [category, p.cases.filter((row) => row.case.category === category)] as const
      ),
    ] as const;
    for (const [label, rows] of slices) {
      if (rows.length === 0) continue;
      const metrics = summarizeCapability(rows);
      out(
        `| ${candidate.candidate.label} | ${label} | ${rows.length} | ${pct(metrics.coreFacetCoverage)} | ${pct(metrics.weightedExplanationCompleteness)} | ${pct(metrics.generation.groundingCoverage)} | ${pct(metrics.causalCoherence)} | ${pct(metrics.generation.wrongLanguage)} | ${pct(metrics.usableExplanation)} |`
      );
    }
  }

  out();
  out("## Candidate and decoding manifest");
  out();
  out(
    "| Candidate | Model/revision | Family | Decoding | Source | Temperature | top_p | top_k | presence | repetition | Max tokens | Chat template | Decoding note |"
  );
  out("| --- | --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | --- | --- |");
  for (const candidate of input.candidates) {
    const generation = pSection(candidate)?.artifacts.manifest.generation;
    out(
      `| ${candidate.candidate.label} | ${candidate.candidate.model ?? "N/A"}${candidate.candidate.revision ? ` @ ${candidate.candidate.revision}` : ""} | ${candidate.candidate.family ?? "N/A"} | ${generation?.decodingId ?? "N/A"} | ${generation?.decodingSource ?? "N/A"} | ${generation?.temperature ?? "N/A"} | ${generation?.topP ?? "N/A"} | ${generation?.topK ?? "N/A"} | ${generation?.presencePenalty ?? "N/A"} | ${generation?.repetitionPenalty ?? "N/A"} | ${generation?.maxTokens ?? "N/A"} | ${generation?.chatTemplate ?? "N/A"} | ${generation?.decodingNote ?? "N/A"} |`
    );
  }

  out();
  out("## Truncation and max-token audit");
  out();
  out("New qualification runs use the same 512-token capability ceiling for every applicable candidate.");
  out("A row is truncated only when the provider explicitly returns finish=length; a missing finish reason is N/A.");
  out(
    "The known legacy Qwen transcript used a 400-token manifest and did not record finish reasons, so its truncation rate remains N/A."
  );

  out();
  out("## Quality table (raw P)");
  out();
  out("| Candidate | Core | Supporting | Weighted | Grounding | Ungrounded | Language | Usable | Truncated |");
  out("| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |");
  for (const candidate of input.candidates) {
    const metrics = pSection(candidate)?.metrics;
    out(
      `| ${candidate.candidate.label} | ${metrics ? pct(metrics.coreFacetCoverage) : "N/A"} | ${metrics ? pct(metrics.supportingFacetCoverage) : "N/A"} | ${metrics ? pct(metrics.weightedExplanationCompleteness) : "N/A"} | ${metrics ? pct(metrics.generation.groundingCoverage) : "N/A"} | ${metrics ? pct(metrics.generation.substantiallyUngrounded) : "N/A"} | ${metrics ? pct(metrics.generation.wrongLanguage) : "N/A"} | ${metrics ? pct(metrics.usableExplanation) : "N/A"} | ${metrics?.generation.truncated === null || !metrics ? "N/A" : pct(metrics.generation.truncated)} |`
    );
  }

  out();
  out("## Performance table (raw P)");
  out();
  out(
    "| Candidate | Cold start | Warm init | Session create | Prompt tok | Completion tok | TTFT | Median | P95 | tok/s | Bytes |"
  );
  out("| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |");
  for (const candidate of input.candidates) {
    const p = pSection(candidate);
    const metrics = p?.metrics;
    const runtime = p?.artifacts.manifest.runtime;
    out(
      `| ${candidate.candidate.label} | ${seconds(runtime?.coldStartMs)} | ${seconds(runtime?.warmInitMs)} | ${seconds(runtime?.sessionCreateMs)} | ${metrics?.runtime.promptTokens ?? "N/A"} | ${metrics?.runtime.completionTokens ?? "N/A"} | ${seconds(metrics?.runtime.medianTtftMs)} | ${seconds(metrics?.runtime.medianLatencyMs)} | ${seconds(metrics?.runtime.p95LatencyMs)} | ${metrics?.runtime.tokensPerSecond === null || !metrics ? "N/A" : metrics.runtime.tokensPerSecond.toFixed(1)} | ${runtime?.downloadBytes === undefined ? "N/A" : formatBytes(runtime.downloadBytes)} |`
    );
  }

  out();
  out("## Capability profiles");
  out();
  out(
    "Profiles are derived from measured cases. `unmeasured` means this explanation benchmark did not establish that capability."
  );
  out();
  out("| Candidate | navigation | lookup | explain | deepExplain | groundedSynthesis | portuguese | english |");
  out("| --- | --- | --- | --- | --- | --- | --- | --- |");
  for (const candidate of input.candidates) {
    const profile = candidate.profile;
    out(
      `| ${candidate.candidate.label} | ${profile?.navigation ?? "unmeasured"} | ${profile?.lookup ?? "unmeasured"} | ${profile?.explain ?? "unmeasured"} | ${profile?.deepExplain ?? "unmeasured"} | ${profile?.groundedSynthesis ?? "unmeasured"} | ${profile?.portuguese ?? "unmeasured"} | ${profile?.english ?? "unmeasured"} |`
    );
  }

  out();
  out("## Pleasantness is not correctness");
  out();
  out("The report keeps these dimensions separate:");
  out();
  out("- pleasantness: human review of clarity and naturalness;");
  out("- correctness: deterministic facet, symbol and failure detectors;");
  out("- grounding: claims supported by evidence actually shown to the model;");
  out("- completeness: weighted coverage of core, supporting and optional explanation facets.");
  out();
  out("Human review is not used to replace the grounding or quality gates.");

  if (input.groundingCalibration) {
    out();
    out("## Grounding detector calibration");
    out();
    out(`Known Qwen P grounding before detector correction: ${pct(input.groundingCalibration.before)}`);
    out(`Qwen P grounding after detector correction/rescore: ${pct(input.groundingCalibration.after)}`);
    out(`Reason: ${input.groundingCalibration.reason}`);
    out(
      "The Qwen quality verdict remains unchanged: its smoke gate still fails; this correction only removes a false negative in passage matching."
    );
  }

  out();
  out("## Manual grounding-detector validation");
  out();
  out(
    "Five Qwen P transcripts were read before qualifying another candidate. Across them we checked clearly supported mechanism claims, partial/mixed truth-and-invention, invented history/entity, and paraphrased technical explanations."
  );
  out(
    "The supported/paraphrase samples are accepted when their claims share sufficient vocabulary with the evidence; mixed claims remain unsupported as a conservative whole-sentence result; invented history/entity claims remain fatal. This calibration does not replace deterministic scoring or change the Qwen verdict."
  );

  appendAcceptance(out, input.candidates);

  out();
  out("## Selection");
  out();
  out(`**${verdict}**`);
  out();
  out(
    winner
      ? `Efficiency winner among quality-passed candidates: **${winner.candidate.label}**. Ordering used grounding/reliability, completeness, total latency/TTFT, availability, memory and then size hints; no mixed magic score.`
      : "No efficiency winner: no candidate has passed the full quality gate yet."
  );
  if (winner?.candidate.provider === "chrome-language-model") {
    out(
      fallback
        ? `Downloadable fallback: **${fallback.candidate.label}**.`
        : "Downloadable fallback: no qualified candidate yet; use deterministic documentation/search mode until one passes P."
    );
  }
  out();
  out(
    "Chrome availability is an infrastructure result, not a model-quality failure. An unavailable Chrome runtime remains separate from failed P quality."
  );
  out("The next experiment is R only for a candidate with a passing full P; X follows only after R.");

  for (const candidate of input.candidates) {
    if (candidate.sections.length < 2) continue;
    out();
    out(`## P/R/X detail — ${candidate.candidate.label}`);
    out();
    out(
      "The per-candidate detail remains available in the standard report renderer; this shootout intentionally keeps the comparison tables above concise."
    );
  }

  return lines.join("\n");
}

function appendAcceptance(out: (line?: string) => void, candidates: readonly ShootoutCandidateResult[]) {
  out();
  out("## Acceptance outputs");
  out();
  out("Raw answers are printed without editing or summarization for every candidate that completed the smoke set.");
  for (const question of ["por que a JIT é tão rápida?", "como a JIT funciona?"]) {
    out();
    out(`### ${question}`);
    for (const candidate of candidates) {
      const p = pSection(candidate);
      const row = p?.cases.find((entry) => entry.case.question === question);
      if (!row) continue;
      out();
      out(`#### ${candidate.candidate.label}`);
      out(row.rawAnswer);
      out();
      out(
        `Measured: core ${pct(row.capability.coreFacetCoverage)} · supporting ${pct(row.capability.supportingFacetCoverage)} · grounding ${pct(row.measurement.audit.grounding.coverage)} · unsupported claims ${row.measurement.audit.grounding.claims - row.measurement.audit.grounding.supported} · causal ${pct(row.capability.causalCoherence)} · chars ${row.rawAnswer.length} · latency ${seconds(row.latencyMs)}`
      );
    }
  }

  out();
  out("## Human review scaffold");
  out();
  out(
    "Score each selected output separately: clarity, naturalness and explanatory quality from 1 (unacceptable) to 5 (excellent). This scaffold is intentionally blank until a human reviews the raw transcripts."
  );
}

function formatParams(candidate: ShootoutCandidateIdentity): string {
  return candidate.parameterCount === undefined ? "unknown/not exposed" : formatCount(candidate.parameterCount);
}

function formatCount(value: number): string {
  if (value >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(1)}B`;
  return `${Math.round(value / 1_000_000)}M`;
}

function formatGate(gate: { passed: boolean; reasons: string[] } | null): string {
  if (!gate) return "not-run";
  return gate.passed ? "PASS" : `FAIL (${gate.reasons.join(", ")})`;
}

function formatSmoke(candidate: ShootoutCandidateResult, gate: { passed: boolean; reasons: string[] } | null): string {
  if (gate) return formatGate(gate);
  return candidate.availability === "unsupported" || candidate.availability === "unavailable"
    ? "UNAVAILABLE"
    : "not-run";
}

function formatSize(candidate: ShootoutCandidateResult, observed?: number): string {
  if (observed !== undefined) return formatBytes(observed);
  return candidate.candidate.approximateBytes === undefined
    ? "N/A"
    : `~${formatBytes(candidate.candidate.approximateBytes)}`;
}

function formatBytes(value: number): string {
  if (value >= 1024 * 1024 * 1024) return `${(value / (1024 * 1024 * 1024)).toFixed(2)} GiB`;
  return `${Math.round(value / (1024 * 1024))} MiB`;
}
