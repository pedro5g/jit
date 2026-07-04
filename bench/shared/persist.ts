import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { run } from "mitata";
import { biasRegistry, scenarioRegistry } from "./scenario.js";

const resultsDir = fileURLToPath(new URL("../results/", import.meta.url));

export interface PersistedStats {
  readonly avg: number;
  readonly min: number;
  readonly max: number;
  readonly p25: number;
  readonly p50: number;
  readonly p75: number;
  readonly p99: number;
  readonly p999: number;
  readonly ticks: number;
  readonly samples: number;
  readonly gc?: { avg: number; min: number; max: number; total: number };
  readonly heap?: { avg: number; min: number; max: number; total: number };
}

export interface PersistedRun {
  readonly name: string;
  readonly error?: string;
  readonly stats?: PersistedStats;
}

export interface PersistedSuite {
  readonly suite: string;
  readonly capturedAt: string;
  readonly node: string;
  readonly platform: string;
  readonly context: unknown;
  readonly biased: Record<string, string>;
  /** bench name → scenario key; scenario names alone collide across ops. */
  readonly scenarios: Record<string, string>;
  readonly runs: PersistedRun[];
}

/**
 * Runs all registered mitata benches (normal terminal output) and persists a
 * compact JSON snapshot to `bench/results/<suite>.latest.json` plus a
 * timestamped copy. Raw sample arrays are dropped — only aggregates survive.
 */
export async function runSuite(suite: string): Promise<void> {
  const result = await run();
  const capturedAt = new Date().toISOString();

  const runs: PersistedRun[] = [];

  for (const trial of result.benchmarks) {
    for (const benchRun of trial.runs) {
      const persisted: { name: string; error?: string; stats?: PersistedStats } = { name: benchRun.name };

      if (benchRun.error !== undefined) {
        persisted.error = String((benchRun.error as { message?: string }).message ?? benchRun.error);
      }

      if (benchRun.stats !== undefined) {
        const stats: PersistedStats = {
          avg: benchRun.stats.avg,
          min: benchRun.stats.min,
          max: benchRun.stats.max,
          p25: benchRun.stats.p25,
          p50: benchRun.stats.p50,
          p75: benchRun.stats.p75,
          p99: benchRun.stats.p99,
          p999: benchRun.stats.p999,
          ticks: benchRun.stats.ticks,
          samples: benchRun.stats.samples.length,
          ...(benchRun.stats.gc ? { gc: benchRun.stats.gc } : {}),
          ...(benchRun.stats.heap ? { heap: benchRun.stats.heap } : {}),
        };
        persisted.stats = stats;
      }

      runs.push(persisted);
    }
  }

  const payload: PersistedSuite = {
    suite,
    capturedAt,
    node: process.version,
    platform: `${process.platform}-${process.arch}`,
    context: result.context,
    biased: Object.fromEntries(biasRegistry),
    scenarios: Object.fromEntries(scenarioRegistry),
    runs,
  };

  const json = JSON.stringify(payload, null, 2);
  const stamp = capturedAt.replace(/[:.]/g, "-");

  mkdirSync(resultsDir, { recursive: true });
  writeFileSync(join(resultsDir, `${suite}.latest.json`), json);
  writeFileSync(join(resultsDir, `${suite}.${stamp}.json`), json);

  console.log(`\n[bench] persisted ${suite} results to bench/results/${suite}.latest.json`);
}
