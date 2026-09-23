import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createNodeProfile } from "../packages/jit/src/compiler/target/v8/profile.js";

interface StrategyMeasurement {
  readonly scenario: { readonly length: number; readonly elementCost: string; readonly result: string };
  readonly measurement: {
    readonly ratio: number;
    readonly dispersion: number;
    readonly samples: number;
    readonly processSamples?: number;
  };
}

interface StrategyReport {
  readonly fingerprint: { readonly node: string };
  readonly measurements: readonly StrategyMeasurement[];
}

const major = process.version.match(/^v?([0-9]+)/)?.[1];
if (major === undefined || !["22", "24", "26"].includes(major))
  throw new Error(`no reviewed Node profile exists for runtime ${process.version}`);

const reportPath = resolve("perf/results", `strategies.node-${major}.json`);
const report = JSON.parse(readFileSync(reportPath, "utf8")) as StrategyReport;
if (report.fingerprint.node.match(/^v?([0-9]+)/)?.[1] !== major)
  throw new Error(`strategy report fingerprint does not match Node ${major}`);
if (report.measurements.length === 0) throw new Error("strategy report contains no scenarios");

const byLength = new Map<number, StrategyMeasurement[]>();
for (const entry of report.measurements) {
  const values = byLength.get(entry.scenario.length) ?? [];
  values.push(entry);
  byLength.set(entry.scenario.length, values);
}

const profile = createNodeProfile(major);
const currentLimit = profile.limits.arrayUnrollMaxLength;
const lengthSummary = [...byLength]
  .filter(([length]) => length > 0)
  .sort(([left], [right]) => left - right)
  .map(([length, entries]) => {
    const ratios = entries.map((entry) => entry.measurement.ratio).sort((left, right) => left - right);
    const medianRatio = ratios[Math.floor(ratios.length / 2)] ?? 0;
    const robust = entries.every(
      (entry) =>
        entry.measurement.dispersion <= 0.03 &&
        (entry.measurement.processSamples ?? 0) >= 5 &&
        entry.measurement.samples >= 45
    );
    const winsAcrossScenarios = entries.every((entry) => entry.measurement.ratio <= 0.95);
    return Object.freeze({ length, scenarios: entries.length, medianRatio, robust, winsAcrossScenarios });
  });

let suggestedMaxLength = 0;
for (const summary of lengthSummary) {
  if (summary.length !== suggestedMaxLength + 1 || !summary.robust || !summary.winsAcrossScenarios) break;
  suggestedMaxLength = summary.length;
}

const proposal = Object.freeze({
  kind: "performance-profile-proposal",
  version: 1,
  targetProfile: `node-${major}`,
  current: { arrayUnrollMaxLength: currentLimit },
  suggested: { arrayUnrollMaxLength: suggestedMaxLength },
  evidence: ["PERF-ARRAY-001"],
  confidence: lengthSummary.length > 0 && lengthSummary.every((entry) => entry.robust) ? "high" : "low",
  affectedOperations: ["validate"],
  fingerprint: report.fingerprint,
  lengths: lengthSummary,
  requiresHumanReview: true,
});

const outputPath = resolve("perf/results", `profile-proposal.node-${major}.json`);
writeFileSync(outputPath, `${JSON.stringify(proposal, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ ...proposal, outputPath }, null, 2));
