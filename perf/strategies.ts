import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { measureIsolatedRatio } from "./harness/measure.js";

const smoke = process.argv.includes("--smoke");
const processes = readOption("--processes", smoke ? 3 : 5);
const samples = readOption("--samples", smoke ? 3 : 9);
const iterations = readOption("--iterations", smoke ? 250 : 1000);
const lengths = smoke ? [1, 5, 12] : [0, 1, 2, 3, 4, 5, 6, 8, 10, 12, 16, 24, 32, 64];
const costs = smoke ? (["trivial"] as const) : (["trivial", "medium", "high"] as const);
const results = smoke
  ? (["success", "fail-first", "fail-last"] as const)
  : (["success", "fail-first", "fail-middle", "fail-last"] as const);
const scenarioUrl = pathToFileURL(resolve("perf/scenarios/fixed-array.ts")).href;
const measurements = [];

for (const length of lengths) {
  for (const elementCost of costs) {
    for (const result of results) {
      if (length === 0 && result !== "success") continue;
      const scenario = { length, elementCost, result };
      measurements.push({
        scenario,
        measurement: measureIsolatedRatio(
          `array.fixed.${length}.${elementCost}.${result}`,
          scenarioUrl,
          "indexed-loop",
          "unrolled",
          { processes, samples, iterations, warmup: 1000, scenario }
        ),
      });
    }
  }
}

const major = process.version.match(/^v?([0-9]+)/)?.[1] ?? "unknown";
const report = {
  version: 1,
  family: "array.validate",
  fingerprint: measurements[0]?.measurement.fingerprint,
  policy: { processes, samplesPerProcess: samples, iterations, smoke },
  measurements,
};
mkdirSync("perf/results", { recursive: true });
writeFileSync(resolve("perf/results", `strategies.node-${major}.json`), `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(JSON.stringify(report, null, 2));

function readOption(name: string, fallback: number): number {
  const index = process.argv.indexOf(name);
  if (index < 0) return fallback;
  const value = Number(process.argv[index + 1]);
  if (!Number.isSafeInteger(value) || value < 1) throw new RangeError(`${name} must be a positive integer`);
  return value;
}
