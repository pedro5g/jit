/**
 * `pnpm knowledge:rescore` — new detectors, old transcripts, no generation.
 *
 * Generation is the expensive half: hours of CPU for three configurations. A
 * detector is a pure function of the answer and the context it was given, so
 * separating them means a gap found while *reading* the answers can be
 * measured against the answers already collected — §PART 9.
 *
 * The gap that motivated this is worth recording. The first table reported
 * "invented API: 0.0%" for a configuration whose answers included "Ajit Jain,
 * o criador da JIT" — a fabricated person, a fabricated history, and not one
 * invented API name, because the answer never mentioned an API at all. A
 * name-based detector is blind to prose that is wholly invented.
 *
 * This is also §PART 24's shadow mode: the audit analyses, scores and
 * classifies, and changes nothing. What it would have rejected is a column in
 * a table, not an answer a reader lost. And where a run has been labelled by
 * hand (§PART 25), the same pass reports what the detectors got right and
 * wrong against that reading.
 */

import { execFileSync } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { ARTIFACT_DIR } from "../../lib/copilot/config/artifacts.js";
import { QUALIFICATION_CANDIDATES } from "../../lib/copilot/config/models.js";
import type { Locale } from "../../lib/copilot/core/value-objects/locale.js";
import {
  type CaseRecord,
  type ContextRecord,
  fromJsonl,
  type ResponseRecord,
  type RunManifest,
} from "../../lib/copilot/eval/artifacts.js";
import { rescoreCapabilityRun } from "../../lib/copilot/eval/capability.js";
import type { CapabilityReportSection } from "../../lib/copilot/eval/capability-report.js";
import { type MeasuredCase, measureAnswer, measureGeneration } from "../../lib/copilot/eval/detectors.js";
import { type AnswerLabel, shadowMetrics } from "../../lib/copilot/eval/labels.js";
import {
  renderModelShootoutReport,
  type ShootoutCandidateIdentity,
  type ShootoutCandidateResult,
} from "../../lib/copilot/eval/model-shootout-report.js";
import { BROWSER_NOTE, type ReportSection, renderReport } from "../../lib/copilot/eval/report.js";
import type { EvalCase } from "../../lib/copilot/eval/types.js";
import { createKnowledgeEngine } from "../../lib/copilot/infrastructure/knowledge-engine.js";
import { NodeArtifactLoader } from "../../lib/copilot/infrastructure/storage/node-artifact-loader.js";

const siteDir = path.resolve(import.meta.dirname, "../..");
const evalDir = path.join(siteDir, ".eval/copilot");
const runsDir = path.join(evalDir, "runs");

const engine = await createKnowledgeEngine(new NodeArtifactLoader(path.join(siteDir, "public", ARTIFACT_DIR)));

/**
 * Which runs to score.
 *
 * The most recent run per candidate/configuration/decoding by default. A
 * single "latest P" slot would silently compare one candidate with another,
 * which is precisely what the shootout manifest is meant to prevent.
 */
async function latestRuns(): Promise<string[]> {
  const entries = await fs.readdir(runsDir).catch(() => [] as string[]);
  const byCandidate = new Map<string, string>();

  for (const entry of entries.sort()) {
    const manifest = JSON.parse(
      await fs.readFile(path.join(runsDir, entry, "manifest.json"), "utf8").catch(() => "null")
    ) as RunManifest | null;
    if (manifest) {
      const key = [
        manifest.config,
        manifest.model.id,
        manifest.runtime.provider,
        manifest.model.dtype ?? "",
        manifest.generation.decodingId ?? "",
      ].join("|");
      byCandidate.set(key, entry);
    }
  }

  return [...byCandidate.values()].sort();
}

/**
 * The hand-read ground truth for a run, when there is one.
 *
 * Absent by default and that is fine: the shadow table simply does not appear,
 * rather than appearing with numbers derived from the detectors judging
 * themselves.
 */
async function labelsFor(runId: string): Promise<AnswerLabel[]> {
  const file = path.join(evalDir, "labels", `${runId}.jsonl`);
  const text = await fs.readFile(file, "utf8").catch(() => "");
  return text ? fromJsonl<AnswerLabel>(text) : [];
}

const requested = process.argv.slice(2).filter((argument) => !argument.startsWith("--"));
const runs = requested.length > 0 ? requested : await latestRuns();

if (runs.length === 0) {
  console.error("no runs under .eval/copilot/runs — run pnpm knowledge:benchmark first");
  process.exit(1);
}

const capabilityRuns = await Promise.all(
  runs.map(async (run) => {
    const manifest = JSON.parse(await fs.readFile(path.join(runsDir, run, "manifest.json"), "utf8")) as RunManifest;
    return manifest.benchmarkKind === "capability" ||
      manifest.benchmarkKind === "real-context" ||
      manifest.config === "X"
      ? { run, manifest }
      : null;
  })
).then((items) => items.filter((item): item is { run: string; manifest: RunManifest } => item !== null));

if (capabilityRuns.length > 0) {
  const byCandidate = new Map<string, ShootoutCandidateResult>();
  for (const { run, manifest } of capabilityRuns) {
    const dir = path.join(runsDir, run);
    const artifacts = {
      manifest,
      cases: fromJsonl<CaseRecord>(await fs.readFile(path.join(dir, "cases.jsonl"), "utf8")),
      contexts: fromJsonl<ContextRecord>(await fs.readFile(path.join(dir, "contexts.jsonl"), "utf8")),
      responses: fromJsonl<ResponseRecord>(await fs.readFile(path.join(dir, "responses.jsonl"), "utf8")),
    };
    const rescored = rescoreCapabilityRun({ engine, ...artifacts });
    if (!["P", "R", "X"].includes(manifest.config)) continue;
    const registered = QUALIFICATION_CANDIDATES.find(
      (candidate) =>
        candidate.id === manifest.model.id ||
        (candidate.model === manifest.model.repo && candidate.dtype === manifest.model.dtype)
    );
    const candidate: ShootoutCandidateIdentity = registered
      ? {
          id: registered.id,
          label: registered.label,
          provider: registered.provider,
          ...(registered.model ? { model: registered.model } : {}),
          family: registered.modelFamily,
          ...(registered.modelRevision ? { revision: registered.modelRevision } : {}),
          ...(registered.dtype ? { dtype: registered.dtype } : {}),
          ...(registered.parameterCount !== undefined ? { parameterCount: registered.parameterCount } : {}),
          ...(registered.approximateBytes !== undefined ? { approximateBytes: registered.approximateBytes } : {}),
        }
      : {
          id: manifest.model.id,
          label: manifest.model.label,
          provider: manifest.runtime.provider === "transformers.js" ? "transformers-webgpu" : manifest.runtime.provider,
          ...(manifest.model.repo ? { model: manifest.model.repo } : {}),
          ...(manifest.model.family ? { family: manifest.model.family } : {}),
          ...(manifest.model.revision ? { revision: manifest.model.revision } : {}),
          ...(manifest.model.dtype ? { dtype: manifest.model.dtype } : {}),
          ...(manifest.model.parameterCount !== undefined ? { parameterCount: manifest.model.parameterCount } : {}),
        };
    const key = [candidate.id, manifest.model.dtype ?? "", manifest.generation.decodingId ?? ""].join("|");
    const current = byCandidate.get(key) ?? {
      candidate,
      sections: [],
      profile: rescored.profile,
      availability: manifest.runtime.availability ?? manifest.runtime.compatibility,
    };
    const section: CapabilityReportSection = {
      config: manifest.config as "P" | "R" | "X",
      label: manifest.configLabel,
      artifacts,
      cases: rescored.measured,
      metrics: rescored.metrics,
      deliveredMetrics: rescored.deliveredMetrics,
      profile: rescored.profile,
    };
    byCandidate.set(key, {
      ...current,
      sections: [...current.sections, section].sort((left, right) => left.config.localeCompare(right.config)),
    });
  }

  for (const candidate of QUALIFICATION_CANDIDATES) {
    const keyPrefix = `${candidate.id}|`;
    if ([...byCandidate.keys()].some((key) => key.startsWith(keyPrefix))) continue;
    byCandidate.set(keyPrefix, {
      candidate: {
        id: candidate.id,
        label: candidate.label,
        provider: candidate.provider,
        ...(candidate.model ? { model: candidate.model } : {}),
        family: candidate.modelFamily,
        ...(candidate.dtype ? { dtype: candidate.dtype } : {}),
        ...(candidate.parameterCount !== undefined ? { parameterCount: candidate.parameterCount } : {}),
        ...(candidate.approximateBytes !== undefined ? { approximateBytes: candidate.approximateBytes } : {}),
      },
      sections: [],
      availability: candidate.provider === "chrome-language-model" ? "not-recorded" : "not-run",
    });
  }

  const candidates = [...byCandidate.values()];
  const qwenP = candidates
    .find((candidate) => candidate.candidate.id === "qwen3.5-0.8b-q4f16")
    ?.sections.find((section) => section.config === "P");
  const report = renderModelShootoutReport({
    candidates,
    testedCommit: `${execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim()} (working tree changes present)`,
    benchmarkVersion: "jit-copilot-p1-v1",
    datasetVersion: Math.max(
      ...candidates
        .flatMap((candidate) => candidate.sections)
        .map((section) => section.artifacts.manifest.datasetVersion),
      2
    ),
    knowledgeHash: candidates.flatMap((candidate) => candidate.sections).find(Boolean)?.artifacts.manifest.knowledge
      .contentHash,
    ...(qwenP
      ? {
          groundingCalibration: {
            before: 0,
            after: qwenP.metrics.generation.groundingCoverage,
            reason:
              "the detector preserved only the last passage for repeated knowledgeId values; it now retains every context passage as a separate vocabulary set",
          },
        }
      : {}),
  });
  console.log(`\n${report}`);
  const stamp = new Date().toISOString().slice(0, 16).replace(/[:]/g, "").replace("T", "-");
  const reportFile = path.join(evalDir, "reports", `${stamp}-model-shootout.md`);
  await fs.mkdir(path.dirname(reportFile), { recursive: true });
  await fs.writeFile(
    reportFile,
    `${report}\n## Runs\n\n${capabilityRuns.map(({ run }) => `- \`${run}\``).join("\n")}\n`
  );
  console.log(`  written to ${path.relative(siteDir, reportFile)}\n`);
  process.exit(0);
}

const sections: ReportSection[] = [];
const perRun: { runId: string; rows: MeasuredCase[] }[] = [];

for (const run of runs) {
  const dir = path.join(runsDir, run);
  const manifest = JSON.parse(await fs.readFile(path.join(dir, "manifest.json"), "utf8")) as RunManifest;

  const cases = fromJsonl<CaseRecord>(await fs.readFile(path.join(dir, "cases.jsonl"), "utf8"));
  const contexts = new Map(
    fromJsonl<ContextRecord>(await fs.readFile(path.join(dir, "contexts.jsonl"), "utf8")).map((record) => [
      record.question,
      record,
    ])
  );
  const responses = new Map(
    fromJsonl<ResponseRecord>(await fs.readFile(path.join(dir, "responses.jsonl"), "utf8")).map((record) => [
      record.question,
      record,
    ])
  );

  const rows: MeasuredCase[] = [];

  for (const record of cases) {
    const context = contexts.get(record.question);
    const response = responses.get(record.question);
    if (!context || !response) continue;

    const testCase = { ...record, locale: record.locale as Locale } as EvalCase;

    rows.push({
      case: testCase,
      measurement: measureAnswer({
        answer: response.answer,
        case: testCase,
        // The context recorded at generation time, not one rebuilt now: the
        // knowledge build may have moved since, and scoring an answer against
        // evidence it never saw measures nothing.
        context: context.context,
        symbols: engine.symbols,
        knowledge: engine.knowledge,
        corpusKnows: (term) => engine.lexical.knows(term),
        sourceOnly: response.delivery === "grounded-synthesis",
      }),
      latencyMs: response.latencyMs,
      tokensPerSecond: response.tokensPerSecond,
      ...(response.ttftMs ? { ttftMs: response.ttftMs } : {}),
      ...(context.retrievalTimings ? { retrievalTimings: context.retrievalTimings } : {}),
    });
  }

  const labels = await labelsFor(run);

  sections.push({
    config: manifest.config,
    label: manifest.configLabel,
    manifest,
    cases: rows,
    metrics: measureGeneration(rows),
    shadow:
      labels.length > 0
        ? shadowMetrics(
            rows.map((row) => ({ question: row.case.question, result: row.measurement.audit })),
            labels
          )
        : null,
  });

  perRun.push({ runId: run, rows });
}

/**
 * Two tables, never one — §PART 28.
 *
 * A browser run and a headless run measure different runtimes on different
 * hardware. Merging them into a single table would produce a row where a
 * WebGPU latency sits beside a CPU one under the same heading, which is the
 * averaging the failure taxonomy exists to prevent. The split is by the
 * manifest's own `browser` block, so nothing has to be labelled by hand.
 */
const headless = sections.filter((section) => !section.manifest?.browser);
const browser = sections.filter((section) => section.manifest?.browser);

const tables: string[] = [];

if (headless.length > 0) {
  tables.push(
    renderReport(headless, {
      title: "Headless benchmark — A/B/C",
      cases: Math.max(...headless.map((section) => section.cases.length)),
    })
  );
}

if (browser.length > 0) {
  tables.push(
    renderReport(browser, {
      title: "Browser product benchmark — WebGPU",
      cases: Math.max(...browser.map((section) => section.cases.length)),
      runtime: "greedy decoding · WebGPU · the tier a reader gets",
      notes: BROWSER_NOTE,
    })
  );
}

const report = tables.join("\n");

console.log(`\n${report}`);

/**
 * The report is an artifact too — §PART 8.
 *
 * A table that exists only in a terminal buffer cannot be diffed against the
 * next one, and "it improved" is exactly the claim that needs a diff.
 */
const stamp = new Date().toISOString().slice(0, 16).replace(/[:]/g, "").replace("T", "-");
const reportFile = path.join(evalDir, "reports", `${stamp}.md`);

await fs.mkdir(path.dirname(reportFile), { recursive: true });
await fs.writeFile(reportFile, `${report}\n## Runs\n\n${runs.map((run) => `- \`${run}\``).join("\n")}\n`);

console.log(`  written to ${path.relative(siteDir, reportFile)}\n`);

// ------------------------------------------------------------------ findings
if (process.argv.includes("--findings")) {
  for (const { runId, rows } of perRun) {
    console.log(`\n\n=== ${runId} ===`);
    for (const row of rows) {
      if (row.measurement.audit.findings.length === 0) continue;
      console.log(`\n  ${row.case.question}`);
      for (const finding of row.measurement.audit.findings) {
        console.log(`    [${finding.severity}] ${finding.kind}: ${finding.detail}`);
        for (const offender of finding.offenders.slice(0, 2)) console.log(`        ${offender}`);
      }
    }
  }
}
