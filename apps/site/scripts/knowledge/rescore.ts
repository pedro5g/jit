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
import { promises as fs } from "node:fs";
import path from "node:path";
import { ARTIFACT_DIR } from "../../lib/copilot/config/artifacts";
import type { Locale } from "../../lib/copilot/core/value-objects/locale";
import {
  type CaseRecord,
  type ContextRecord,
  fromJsonl,
  type ResponseRecord,
  type RunManifest,
} from "../../lib/copilot/eval/artifacts";
import { type MeasuredCase, measureAnswer, measureGeneration } from "../../lib/copilot/eval/detectors";
import { type AnswerLabel, shadowMetrics } from "../../lib/copilot/eval/labels";
import { BROWSER_NOTE, type ReportSection, renderReport } from "../../lib/copilot/eval/report";
import type { EvalCase } from "../../lib/copilot/eval/types";
import { createKnowledgeEngine } from "../../lib/copilot/infrastructure/knowledge-engine";
import { NodeArtifactLoader } from "../../lib/copilot/infrastructure/storage/node-artifact-loader";

const siteDir = path.resolve(import.meta.dirname, "../..");
const evalDir = path.join(siteDir, ".eval/copilot");
const runsDir = path.join(evalDir, "runs");

const engine = await createKnowledgeEngine(new NodeArtifactLoader(path.join(siteDir, "public", ARTIFACT_DIR)));

/**
 * Which runs to score.
 *
 * The most recent run per configuration by default. Comparing a config from
 * today against one from last week is exactly the mistake the manifest exists
 * to prevent, so the selection makes the correct thing the easy one.
 */
async function latestRuns(): Promise<string[]> {
  const entries = await fs.readdir(runsDir).catch(() => [] as string[]);
  const byConfig = new Map<string, string>();

  for (const entry of entries.sort()) {
    const manifest = JSON.parse(
      await fs.readFile(path.join(runsDir, entry, "manifest.json"), "utf8").catch(() => "null")
    ) as RunManifest | null;
    if (manifest) byConfig.set(manifest.config, entry);
  }

  return [...byConfig.values()].sort();
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
      }),
      latencyMs: response.latencyMs,
      tokensPerSecond: response.tokensPerSecond,
      ...(response.ttftMs ? { ttftMs: response.ttftMs } : {}),
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
