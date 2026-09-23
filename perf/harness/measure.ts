import os from "node:os";
import { performance } from "node:perf_hooks";
import type { PerformanceEvidence, RuntimeFingerprint } from "../../packages/jit/src/compiler/performance/evidence.js";

export interface MeasurementOptions {
  readonly warmup?: number;
  readonly samples?: number;
  readonly iterations?: number;
}

export interface RatioMeasurement {
  readonly name: string;
  readonly fingerprint: RuntimeFingerprint;
  readonly samples: number;
  readonly baselineMedian: number;
  readonly candidateMedian: number;
  readonly ratio: number;
  readonly dispersion: number;
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

  const baselineSamples = sample(baseline, samples, iterations);
  const candidateSamples = sample(candidate, samples, iterations);
  const baselineMedian = median(baselineSamples);
  const candidateMedian = median(candidateSamples);
  const ratio = candidateMedian / Math.max(baselineMedian, Number.MIN_VALUE);
  return Object.freeze({
    name,
    fingerprint: fingerprint(),
    samples,
    baselineMedian,
    candidateMedian,
    ratio,
    dispersion: relativeDispersion([...baselineSamples, ...candidateSamples]),
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
  invoke(compiled);
  const firstCallMs = performance.now() - firstStart;

  const warmup = options.warmup ?? 1_000;
  const samples = options.samples ?? 15;
  const iterations = options.iterations ?? 1_000;
  for (let index = 0; index < warmup; index++) invoke(compiled);
  const steadySamples = sample(() => invoke(compiled), samples, iterations);

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
  for (let sampleIndex = 0; sampleIndex < samples; sampleIndex++) {
    const start = performance.now();
    for (let iteration = 0; iteration < iterations; iteration++) fn();
    result.push(performance.now() - start);
  }
  return result;
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

function heapUsed(): number | undefined {
  const value = (process as NodeJS.Process & { readonly memoryUsage?: () => NodeJS.MemoryUsage }).memoryUsage?.();
  return value?.heapUsed;
}
