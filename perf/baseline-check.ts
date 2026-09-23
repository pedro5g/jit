import { existsSync, readFileSync } from "node:fs";
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
    readonly arch?: string;
    readonly platform?: string;
    readonly cpu?: string;
  };
  readonly measurements: Readonly<Record<string, Measurement>>;
}

interface Baseline {
  readonly version: 1;
  readonly runtime: CriticalReport["fingerprint"];
  readonly scenarios: Readonly<Record<string, Measurement>>;
}

const root = resolve(fileURLToPath(new URL(".", import.meta.url)));
const major = process.version.match(/^v?(\d+)/)?.[1] ?? "unknown";
const reportPath = resolve(root, "results", `critical.node-${major}.json`);
const baselinePath = resolve(root, "baselines", `node-${major}.json`);

if (!existsSync(reportPath)) {
  console.log(`No performance result exists for Node ${major}; check skipped.`);
} else if (!existsSync(baselinePath)) {
  console.log(`No promoted Node ${major} performance baseline exists; check skipped.`);
} else {
  const report = readJson<CriticalReport>(reportPath);
  const baseline = readJson<Baseline>(baselinePath);
  const drift = environmentDrift(baseline.runtime, report.fingerprint);
  if (drift !== undefined) {
    console.log(JSON.stringify({ kind: "environment-drift", reason: drift, node: major }));
  } else {
    const findings: {
      readonly kind: string;
      readonly scenario: string;
      readonly previous: number;
      readonly current: number;
    }[] = [];
    for (const [scenario, current] of Object.entries(report.measurements)) {
      const previous = baseline.scenarios[scenario];
      if (previous === undefined) continue;
      if (!stableEnough(previous) || !stableEnough(current)) {
        findings.push({ kind: "PERF-UNSTABLE", scenario, previous: previous.ratio, current: current.ratio });
        continue;
      }
      if (current.ratio / Math.max(previous.ratio, Number.MIN_VALUE) >= 1.08) {
        findings.push({ kind: "PERF-REGRESSION", scenario, previous: previous.ratio, current: current.ratio });
      }
    }
    console.log(JSON.stringify({ node: major, findings }, null, 2));
    if (findings.some((entry) => entry.kind === "PERF-REGRESSION")) process.exitCode = 1;
  }
}

function stableEnough(value: Measurement): boolean {
  return value.dispersion <= 0.03 && (value.processSamples ?? 0) >= 5 && value.samples >= 45;
}

function environmentDrift(left: Baseline["runtime"], right: CriticalReport["fingerprint"]): string | undefined {
  if (left.arch !== right.arch) return `architecture changed from ${left.arch} to ${right.arch}`;
  if (left.platform !== right.platform) return `platform changed from ${left.platform} to ${right.platform}`;
  if (left.cpu !== right.cpu) return `CPU changed from ${left.cpu ?? "unknown"} to ${right.cpu ?? "unknown"}`;
  const leftMajor = left.node?.match(/^v?(\d+)/)?.[1];
  const rightMajor = right.node?.match(/^v?(\d+)/)?.[1];
  if (leftMajor !== rightMajor) return `Node major changed from ${leftMajor} to ${rightMajor}`;
  return undefined;
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}
