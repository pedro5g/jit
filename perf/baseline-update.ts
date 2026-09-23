import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

interface Measurement {
  readonly ratio: number;
  readonly dispersion: number;
  readonly samples: number;
  readonly processSamples?: number;
  readonly p25: number;
  readonly p75: number;
}

interface CriticalReport {
  readonly scenario: string;
  readonly fingerprint: {
    readonly node?: string;
    readonly v8?: string;
    readonly uv?: string;
    readonly arch?: string;
    readonly platform?: string;
    readonly cpu?: string;
  };
  readonly measurements: Readonly<Record<string, Measurement>>;
}

const root = resolve(fileURLToPath(new URL(".", import.meta.url)));
const currentMajor = process.version.match(/^v?(\d+)/)?.[1];
if (currentMajor === undefined) throw new Error("unrecognized Node version");
const resultPath = resolve(root, "results", `critical.node-${currentMajor}.json`);
const report = JSON.parse(readFileSync(resultPath, "utf8")) as CriticalReport;
if (!report.fingerprint.node || !report.fingerprint.v8 || !report.fingerprint.arch || !report.fingerprint.platform)
  throw new Error("critical benchmark report must include a complete runtime fingerprint");
if (!report.measurements || Object.keys(report.measurements).length === 0)
  throw new Error("critical benchmark report contains no scenarios");

for (const [id, measurement] of Object.entries(report.measurements)) {
  if (!Number.isFinite(measurement.ratio) || !Number.isFinite(measurement.dispersion) || measurement.samples < 1)
    throw new Error(`critical benchmark scenario ${id} has invalid measurements`);
}

const major = report.fingerprint.node.match(/^v?(\d+)/)?.[1];
if (major === undefined) throw new Error("critical benchmark report has an unrecognized Node version");
const output = resolve(root, "baselines", `node-${major}.json`);
const baseline = {
  version: 1 as const,
  runtime: report.fingerprint,
  date: new Date().toISOString(),
  commit: process.env.GITHUB_SHA ?? "working-tree",
  scenarios: report.measurements,
};
mkdirSync(resolve(root, "baselines"), { recursive: true });
writeFileSync(output, `${JSON.stringify(baseline, null, 2)}\n`, "utf8");
console.log(`Promoted explicit Node ${major} performance baseline: ${output}`);
