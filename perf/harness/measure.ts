import { spawnSync } from "node:child_process";
import os from "node:os";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import type { PerformanceEvidence, RuntimeFingerprint } from "../../packages/jit/src/compiler/performance/evidence.js";

export interface MeasurementOptions {
  readonly warmup?: number;
  readonly samples?: number;
  readonly iterations?: number;
  readonly scenario?: unknown;
}

export interface RatioMeasurement {
  readonly name: string;
  readonly fingerprint: RuntimeFingerprint;
  readonly samples: number;
  readonly baselineMedian: number;
  readonly candidateMedian: number;
  readonly ratio: number;
  readonly dispersion: number;
  readonly baselineDispersion: number;
  readonly candidateDispersion: number;
  readonly p25: number;
  readonly p75: number;
  readonly baselineSamples: readonly number[];
  readonly candidateSamples: readonly number[];
  readonly ratioSamples: readonly number[];
  readonly comparison:
    | "candidate-winner"
    | "baseline-winner"
    | "likely-candidate"
    | "likely-baseline"
    | "tie"
    | "unstable";
  readonly processSamples?: number;
}

/** Compile/cold/steady phases for decisions whose setup cost matters. */
export interface PhaseMeasurement {
  readonly name: string;
  readonly fingerprint: RuntimeFingerprint;
  readonly compileMs: number;
  readonly firstCallMs: number;
  readonly steadyMedianMs: number;
  readonly steadyDispersion: number;
  /** Heap delta is an observational signal, never a correctness gate. */
  readonly heapDeltaBytes?: number;
}

let benchmarkSink = 0;

export function fingerprint(): RuntimeFingerprint {
  return Object.freeze({
    node: process.version,
    v8: process.versions.v8,
    uv: process.versions.uv,
    arch: process.arch,
    platform: process.platform,
    cpu: os.cpus()[0]?.model,
  });
}

export function measureRatio(
  name: string,
  baseline: () => unknown,
  candidate: () => unknown,
  options: MeasurementOptions = {}
): RatioMeasurement {
  const warmup = options.warmup ?? 1_000;
  const samples = options.samples ?? 15;
  const iterations = options.iterations ?? 1_000;
  for (let index = 0; index < warmup; index++) {
    baseline();
    candidate();
  }

  const baselineSamples: number[] = [];
  const candidateSamples: number[] = [];
  for (let sampleIndex = 0; sampleIndex < samples; sampleIndex++) {
    const first = sampleIndex % 2 === 0 ? baseline : candidate;
    const second = sampleIndex % 2 === 0 ? candidate : baseline;
    const firstTime = sampleOne(first, iterations);
    const secondTime = sampleOne(second, iterations);
    if (sampleIndex % 2 === 0) {
      baselineSamples.push(firstTime);
      candidateSamples.push(secondTime);
    } else {
      candidateSamples.push(firstTime);
      baselineSamples.push(secondTime);
    }
  }
  const baselineMedian = median(baselineSamples);
  const candidateMedian = median(candidateSamples);
  const ratio = candidateMedian / Math.max(baselineMedian, Number.MIN_VALUE);
  const ratioSamples = baselineSamples.map(
    (value, index) => (candidateSamples[index] ?? 0) / Math.max(value, Number.MIN_VALUE)
  );
  return Object.freeze({
    name,
    fingerprint: fingerprint(),
    samples,
    baselineMedian,
    candidateMedian,
    ratio,
    dispersion: relativeDispersion(ratioSamples),
    baselineDispersion: relativeDispersion(baselineSamples),
    candidateDispersion: relativeDispersion(candidateSamples),
    p25: percentile(ratioSamples, 0.25),
    p75: percentile(ratioSamples, 0.75),
    baselineSamples: Object.freeze([...baselineSamples]),
    candidateSamples: Object.freeze([...candidateSamples]),
    ratioSamples: Object.freeze([...ratioSamples]),
    comparison: comparison(ratioSamples),
  });
}

/** Runs each candidate in fresh processes with the same warmup and sampling protocol. */
export function measureIsolatedRatio(
  name: string,
  scenarioUrl: string,
  baselineId: string,
  candidateId: string,
  options: MeasurementOptions & { readonly processes?: number; readonly runtime?: string } = {}
): RatioMeasurement {
  const processes = options.processes ?? 5;
  if (!Number.isSafeInteger(processes) || processes < 3)
    throw new RangeError("isolated measurements require at least 3 processes");
  const samples = options.samples ?? 9;
  const iterations = options.iterations ?? 1_000;
  const warmup = options.warmup ?? 1_000;
  const baselineSamples: number[] = [];
  const candidateSamples: number[] = [];
  let measuredFingerprint: RuntimeFingerprint | undefined;
  for (let processIndex = 0; processIndex < processes; processIndex++) {
    const pair = isolatedPair(
      scenarioUrl,
      baselineId,
      candidateId,
      { warmup, samples, iterations, ...(options.scenario === undefined ? {} : { scenario: options.scenario }) },
      options.runtime,
      processIndex % 2 === 0
    );
    measuredFingerprint ??= pair.fingerprint;
    if (!sameEngine(measuredFingerprint, pair.fingerprint))
      throw new Error("isolated benchmark processes ran under different runtime fingerprints");
    baselineSamples.push(...pair.baselineSamples);
    candidateSamples.push(...pair.candidateSamples);
  }
  const baselineMedian = median(baselineSamples);
  const candidateMedian = median(candidateSamples);
  const ratioSamples = baselineSamples.map(
    (value, index) => (candidateSamples[index] ?? 0) / Math.max(value, Number.MIN_VALUE)
  );
  return Object.freeze({
    name,
    fingerprint: measuredFingerprint ?? fingerprint(),
    samples: samples * processes,
    baselineMedian,
    candidateMedian,
    ratio: candidateMedian / Math.max(baselineMedian, Number.MIN_VALUE),
    dispersion: relativeDispersion(ratioSamples),
    baselineDispersion: relativeDispersion(baselineSamples),
    candidateDispersion: relativeDispersion(candidateSamples),
    p25: percentile(ratioSamples, 0.25),
    p75: percentile(ratioSamples, 0.75),
    baselineSamples: Object.freeze([...baselineSamples]),
    candidateSamples: Object.freeze([...candidateSamples]),
    ratioSamples: Object.freeze([...ratioSamples]),
    comparison: comparison(ratioSamples),
    processSamples: processes,
  });
}

/** Measures compiler setup separately from the first and steady calls. */
export function measurePhases<T>(
  name: string,
  compile: () => T,
  invoke: (compiled: T) => unknown,
  options: MeasurementOptions = {}
): PhaseMeasurement {
  const before = heapUsed();
  const compileStart = performance.now();
  const compiled = compile();
  const compileMs = performance.now() - compileStart;

  const firstStart = performance.now();
  consumeResult(invoke(compiled));
  const firstCallMs = performance.now() - firstStart;

  const warmup = options.warmup ?? 1_000;
  const samples = options.samples ?? 15;
  const iterations = options.iterations ?? 1_000;
  for (let index = 0; index < warmup; index++) consumeResult(invoke(compiled));
  const steadySamples = sample(() => consumeResult(invoke(compiled)), samples, iterations);

  const after = heapUsed();
  return Object.freeze({
    name,
    fingerprint: fingerprint(),
    compileMs,
    firstCallMs,
    steadyMedianMs: median(steadySamples),
    steadyDispersion: relativeDispersion(steadySamples),
    ...(before === undefined || after === undefined ? {} : { heapDeltaBytes: after - before }),
  });
}

export function toEvidence(
  measurement: RatioMeasurement,
  input: Pick<PerformanceEvidence, "id" | "assumption" | "benchmark"> & { readonly commit?: string }
): PerformanceEvidence {
  return Object.freeze({
    id: input.id,
    assumption: input.assumption,
    benchmark: input.benchmark,
    fingerprint: measurement.fingerprint,
    samples: measurement.samples,
    median: measurement.candidateMedian,
    dispersion: measurement.dispersion,
    ratio: measurement.ratio,
    ...(input.commit === undefined ? {} : { commit: input.commit }),
  });
}

function sample(fn: () => unknown, samples: number, iterations: number): readonly number[] {
  const result: number[] = [];
  for (let sampleIndex = 0; sampleIndex < samples; sampleIndex++) result.push(sampleOne(fn, iterations));
  return result;
}

function sampleOne(fn: () => unknown, iterations: number): number {
  const start = performance.now();
  for (let iteration = 0; iteration < iterations; iteration++) consumeResult(fn());
  return performance.now() - start;
}

function consumeResult(value: unknown): void {
  if (typeof value === "boolean") benchmarkSink += value ? 1 : -1;
  else if (typeof value === "number" && Number.isFinite(value)) benchmarkSink += value;
  else if (typeof value === "string") benchmarkSink += value.length;
  if (!Number.isFinite(benchmarkSink)) benchmarkSink = 0;
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

function relativeDispersion(values: readonly number[]): number {
  const center = median(values);
  if (center === 0) return 0;
  const deviations = values.map((value) => Math.abs(value - center));
  return median(deviations) / center;
}

function percentile(values: readonly number[], fraction: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * fraction))] ?? 0;
}

function comparison(values: readonly number[]): RatioMeasurement["comparison"] {
  const center = median(values);
  const spread = relativeDispersion(values);
  if (spread > 0.1) return "unstable";
  if (center <= 0.95) return spread <= 0.03 ? "candidate-winner" : "likely-candidate";
  if (center >= 1.05) return spread <= 0.03 ? "baseline-winner" : "likely-baseline";
  if (center >= 0.97 && center <= 1.03) return "tie";
  return center < 1 ? "likely-candidate" : "likely-baseline";
}

interface IsolatedPairOptions {
  readonly warmup: number;
  readonly samples: number;
  readonly iterations: number;
  readonly scenario?: unknown;
}

function isolatedPair(
  scenarioUrl: string,
  baselineId: string,
  candidateId: string,
  options: IsolatedPairOptions,
  runtime = process.execPath,
  baselineFirst: boolean
): {
  readonly baselineSamples: readonly number[];
  readonly candidateSamples: readonly number[];
  readonly fingerprint: RuntimeFingerprint;
} {
  const worker = fileURLToPath(new URL("./isolated-worker.ts", import.meta.url));
  const result = spawnSync(
    runtime,
    [
      "--import",
      "tsx",
      "--conditions",
      "@jit/source",
      worker,
      scenarioUrl,
      baselineId,
      candidateId,
      JSON.stringify(options),
      baselineFirst ? "baseline-first" : "candidate-first",
    ],
    { cwd: process.cwd(), encoding: "utf8", timeout: 120_000, maxBuffer: 1_000_000 }
  );
  if (result.status !== 0)
    throw new Error(
      `isolated perf candidate ${candidateId} failed (${result.status}): ${result.stderr || result.stdout}`
    );
  const parsed = JSON.parse(result.stdout) as {
    readonly baselineSamples?: unknown;
    readonly candidateSamples?: unknown;
    readonly fingerprint?: RuntimeFingerprint;
  };
  const validSamples = (values: unknown): values is readonly number[] =>
    Array.isArray(values) && values.every((value) => typeof value === "number" && Number.isFinite(value));
  if (!validSamples(parsed.baselineSamples) || !validSamples(parsed.candidateSamples))
    throw new Error(`isolated perf pair ${baselineId}/${candidateId} returned invalid samples`);
  if (
    parsed.fingerprint === undefined ||
    typeof parsed.fingerprint.node !== "string" ||
    typeof parsed.fingerprint.v8 !== "string"
  )
    throw new Error(`isolated perf pair ${baselineId}/${candidateId} returned no runtime fingerprint`);
  return {
    baselineSamples: parsed.baselineSamples,
    candidateSamples: parsed.candidateSamples,
    fingerprint: parsed.fingerprint,
  };
}

function sameEngine(left: RuntimeFingerprint, right: RuntimeFingerprint): boolean {
  return (
    left.node === right.node && left.v8 === right.v8 && left.arch === right.arch && left.platform === right.platform
  );
}

function heapUsed(): number | undefined {
  const value = (process as NodeJS.Process & { readonly memoryUsage?: () => NodeJS.MemoryUsage }).memoryUsage?.();
  return value?.heapUsed;
}
