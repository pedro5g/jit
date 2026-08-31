/**
 * `pnpm knowledge:label` — the reading step §PART 25 depends on.
 *
 * Precision and recall are claims about whether the detectors were right, and
 * nothing in this system can settle that on its own: an audit scored against
 * its own output measures self-consistency and calls it accuracy. So the
 * transcripts get read by a person, one answer at a time, and the reading is
 * recorded as data.
 *
 * This writes two files per run and never overwrites the second:
 *
 *   <run>.review.md    every answer beside the evidence it was given and what
 *                      the audit thought of it — the sheet to read from;
 *   <run>.jsonl        one label per answer, scaffolded empty, then filled in
 *                      by hand and kept.
 *
 * The scaffold is deliberately empty rather than pre-filled with the audit's
 * own verdict. Pre-filling would turn labelling into agreeing, and the number
 * that comes out the other end would mean nothing.
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
  toJsonl,
} from "../../lib/copilot/eval/artifacts";
import { measureAnswer } from "../../lib/copilot/eval/detectors";
import type { AnswerLabel } from "../../lib/copilot/eval/labels";
import type { EvalCase } from "../../lib/copilot/eval/types";
import { createKnowledgeEngine } from "../../lib/copilot/infrastructure/knowledge-engine";
import { NodeArtifactLoader } from "../../lib/copilot/infrastructure/storage/node-artifact-loader";

const siteDir = path.resolve(import.meta.dirname, "../..");
const evalDir = path.join(siteDir, ".eval/copilot");
const runsDir = path.join(evalDir, "runs");
const labelsDir = path.join(evalDir, "labels");

const engine = await createKnowledgeEngine(new NodeArtifactLoader(path.join(siteDir, "public", ARTIFACT_DIR)));

const requested = process.argv.slice(2).filter((argument) => !argument.startsWith("--"));
const runs = requested.length > 0 ? requested : (await fs.readdir(runsDir).catch(() => [] as string[])).sort();

if (runs.length === 0) {
  console.error("no runs under .eval/copilot/runs — run pnpm knowledge:benchmark first");
  process.exit(1);
}

await fs.mkdir(labelsDir, { recursive: true });

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

  const sheet: string[] = [
    `# Adjudication sheet — ${manifest.config}: ${manifest.configLabel}`,
    "",
    `Run \`${run}\` · knowledge \`${manifest.knowledge.contentHash}\` · prompt v${manifest.promptVersion}`,
    "",
    "For each answer: what is *actually* wrong with it, and would a reader have",
    "been better off not seeing it. The audit's own verdict is printed last, on",
    "purpose — read the answer first.",
    "",
  ];

  const scaffold: AnswerLabel[] = [];

  for (const record of cases) {
    const context = contexts.get(record.question);
    const response = responses.get(record.question);
    if (!context || !response) continue;

    const testCase = { ...record, locale: record.locale as Locale } as EvalCase;
    const measurement = measureAnswer({
      answer: response.answer,
      case: testCase,
      context: context.context,
      symbols: engine.symbols,
      knowledge: engine.knowledge,
      corpusKnows: (term) => engine.lexical.knows(term),
    });

    sheet.push(
      "---",
      "",
      `## ${record.question}`,
      "",
      `\`${record.category}\` · \`${record.locale}\` · ${(response.latencyMs / 1000).toFixed(1)}s`,
      "",
      "### evidence shown",
      "",
      ...context.context.evidence.map(
        (evidence) =>
          `${evidence.index}. **${evidence.title}** — ${evidence.content.slice(0, 220).replace(/\n/g, " ")}…`
      ),
      "",
      "### answer",
      "",
      "```text",
      response.answer.trim(),
      "```",
      "",
      "### the audit said",
      "",
      measurement.audit.findings.length === 0
        ? "- nothing"
        : measurement.audit.findings
            .map(
              (f) =>
                `- [${f.severity}] \`${f.kind}\` ${f.detail}${f.offenders.length ? ` (${f.offenders.join(", ")})` : ""}`
            )
            .join("\n"),
      "",
      `grounding: ${measurement.audit.grounding.verdict} · coverage ${Math.round(
        measurement.audit.grounding.coverage * 100
      )}% · ${measurement.audit.grounding.claims} claims`,
      ""
    );

    scaffold.push({ question: record.question, runId: run, kinds: [], shouldReject: false });
  }

  const sheetFile = path.join(labelsDir, `${run}.review.md`);
  await fs.writeFile(sheetFile, `${sheet.join("\n")}\n`);

  const labelFile = path.join(labelsDir, `${run}.jsonl`);
  const exists = await fs
    .access(labelFile)
    .then(() => true)
    .catch(() => false);

  if (!exists) await fs.writeFile(labelFile, toJsonl(scaffold));

  console.log(
    `  ${run}: ${scaffold.length} answers -> ${path.relative(siteDir, sheetFile)}${exists ? " (labels kept)" : ""}`
  );
}
