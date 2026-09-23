import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const resultsDirectory = resolve(fileURLToPath(new URL(".", import.meta.url)), "results");
const fileNames = existsSync(resultsDirectory)
  ? readdirSync(resultsDirectory)
      .filter((name) => /^(?:critical|strategies)\.node-[\w-]+\.json$/.test(name))
      .sort()
  : [];
const reports = fileNames.map((name) => ({
  file: name,
  value: JSON.parse(readFileSync(resolve(resultsDirectory, name), "utf8")) as Record<string, unknown>,
}));
const document = { version: 1, reports };
const jsonPath = resolve(resultsDirectory, "perf-report.json");
const markdownPath = resolve(resultsDirectory, "perf-report.md");
writeFileSync(jsonPath, `${JSON.stringify(document, null, 2)}\n`, "utf8");
writeFileSync(markdownPath, renderMarkdown(reports), "utf8");

if (process.argv.includes("--json")) console.log(JSON.stringify(document, null, 2));
else console.log(readFileSync(markdownPath, "utf8"));

function renderMarkdown(
  entries: readonly { readonly file: string; readonly value: Record<string, unknown> }[]
): string {
  const lines = ["# JIT performance report", ""];
  if (entries.length === 0) lines.push("No performance reports are available.", "");
  for (const entry of entries) lines.push(...renderReport(entry));
  return `${lines.join("\n")}\n`;
}

function renderReport(entry: { readonly file: string; readonly value: Record<string, unknown> }): string[] {
  const fingerprint = entry.value.fingerprint as
    | { readonly node?: string; readonly v8?: string; readonly cpu?: string }
    | undefined;
  const lines = [
    `## ${entry.file}`,
    "",
    `Node ${fingerprint?.node ?? "?"} · V8 ${fingerprint?.v8 ?? "?"} · ${fingerprint?.cpu ?? "CPU unknown"}`,
    "",
  ];
  const measurements = entry.value.measurements;
  if (isRecord(measurements)) lines.push(...renderNamedMeasurements(measurements));
  if (Array.isArray(measurements)) lines.push(...renderScenarioMeasurements(measurements));
  return lines;
}

function renderNamedMeasurements(measurements: Record<string, unknown>): string[] {
  const lines = ["| Scenario | Candidate / baseline | Dispersion | Result |", "| --- | ---: | ---: | --- | "];
  for (const [name, value] of Object.entries(measurements)) {
    if (!isRecord(value) || typeof value.ratio !== "number" || typeof value.dispersion !== "number") continue;
    lines.push(
      `| ${name} | ${value.ratio.toFixed(3)}x | ${(value.dispersion * 100).toFixed(1)}% | ${String(value.comparison ?? "unclassified")} |`
    );
  }
  return [...lines, ""];
}

function renderScenarioMeasurements(measurements: readonly unknown[]): string[] {
  const lines = [
    "| Length | Element cost | Result case | Unrolled / loop | Dispersion | Confidence |",
    "| ---: | --- | --- | ---: | ---: | --- | ",
  ];
  for (const item of measurements) {
    const row = scenarioMeasurementRow(item);
    if (row !== undefined) lines.push(row);
  }
  return [...lines, ""];
}

function scenarioMeasurementRow(item: unknown): string | undefined {
  if (!isRecord(item) || !isRecord(item.scenario) || !isRecord(item.measurement)) return undefined;
  const { scenario, measurement } = item;
  if (typeof measurement.ratio !== "number" || typeof measurement.dispersion !== "number") return undefined;
  return `| ${String(scenario.length)} | ${String(scenario.elementCost)} | ${String(scenario.result)} | ${measurement.ratio.toFixed(3)}x | ${(measurement.dispersion * 100).toFixed(1)}% | ${String(measurement.comparison)} |`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
