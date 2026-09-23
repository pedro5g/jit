import os from "node:os";
import { performance } from "node:perf_hooks";
import type { MeasurementOptions } from "./measure.js";

interface CandidateFactoryModule {
  createCandidate(id: string, scenario?: unknown): PerfCandidate | Promise<PerfCandidate>;
}

interface PerfCandidate {
  run: () => unknown;
  dispose?: () => void | Promise<void>;
}

const [scenarioUrl, baselineId, candidateId, optionsText, order] = process.argv.slice(2);
if (!scenarioUrl || !baselineId || !candidateId || !optionsText || !order)
  throw new Error("isolated worker requires scenario, candidate pair, options, and sample order");

const module = (await import(scenarioUrl)) as CandidateFactoryModule;
if (typeof module.createCandidate !== "function") throw new TypeError("scenario module must export createCandidate");
const options = JSON.parse(optionsText) as MeasurementOptions;
const baseline = normalize(await module.createCandidate(baselineId, options.scenario));
const candidate = normalize(await module.createCandidate(candidateId, options.scenario));
const warmup = options.warmup ?? 1000;
const samples = options.samples ?? 9;
const iterations = options.iterations ?? 1000;
const baselineSamples: number[] = [];
const candidateSamples: number[] = [];
const baselineFirst = order === "baseline-first";
let benchmarkSink = 0;

try {
  for (let index = 0; index < warmup; index++) {
    if (index % 2 === 0) {
      consumeResult(baseline.run());
      consumeResult(candidate.run());
    } else {
      consumeResult(candidate.run());
      consumeResult(baseline.run());
    }
  }
  for (let sample = 0; sample < samples; sample++) {
    const firstBaseline = sample % 2 === 0 ? baselineFirst : !baselineFirst;
    const first = firstBaseline ? baseline : candidate;
    const second = firstBaseline ? candidate : baseline;
    const firstTime = measure(first.run, iterations);
    const secondTime = measure(second.run, iterations);
    if (firstBaseline) {
      baselineSamples.push(firstTime);
      candidateSamples.push(secondTime);
    } else {
      candidateSamples.push(firstTime);
      baselineSamples.push(secondTime);
    }
  }
} finally {
  await baseline.dispose?.();
  await candidate.dispose?.();
}

console.log(
  JSON.stringify({
    baselineSamples,
    candidateSamples,
    fingerprint: {
      node: process.version,
      v8: process.versions.v8,
      uv: process.versions.uv,
      arch: process.arch,
      platform: process.platform,
      cpu: os.cpus()[0]?.model,
    },
    consumed: benchmarkSink,
  })
);

function normalize(value: (() => unknown) | PerfCandidate): PerfCandidate {
  return typeof value === "function" ? { run: value } : value;
}

function measure(run: () => unknown, iterations: number): number {
  const start = performance.now();
  for (let index = 0; index < iterations; index++) consumeResult(run());
  return performance.now() - start;
}

function consumeResult(value: unknown): void {
  if (typeof value === "boolean") benchmarkSink += value ? 1 : -1;
  else if (typeof value === "number" && Number.isFinite(value)) benchmarkSink += value;
  else if (typeof value === "string") benchmarkSink += value.length;
  if (!Number.isFinite(benchmarkSink)) benchmarkSink = 0;
}
