import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { coverageBaselineMetrics } from "../gates/coverage.js";
import { deadCodeGate } from "../gates/dead-code.js";
import { duplicationGate } from "../gates/duplication.js";
import type { QualityBaseline, QualityContext } from "./context.js";
import { finding, type QualityFinding } from "./finding.js";
import { collectMetrics } from "./metrics.js";

export function initializeBaseline(context: QualityContext): QualityFinding[] {
  const path = resolve(context.root, ".quality/baseline.json");
  if (existsSync(path))
    return [
      finding({
        code: "QG-BASELINE-002",
        gate: "baseline",
        severity: "error",
        title: "Baseline already exists",
        message: "baseline:init is a one-time operation and cannot overwrite a reference baseline.",
        remediation: "Use quality:baseline:update only when the current metrics reduce existing debt.",
      }),
    ];
  mkdirSync(resolve(context.root, ".quality"), { recursive: true });
  mkdirSync(context.reportsDirectory, { recursive: true });
  const metrics = {
    ...Object.fromEntries(
      Object.entries(collectMetrics({ ...context, mode: "full", files: context.files })).map(([file, value]) => [
        file,
        { ...value },
      ])
    ),
    ...coverageBaselineMetrics(context),
  };
  const findings = duplicationGate(context)
    .map((item) => item.fingerprint)
    .filter((fingerprint): fingerprint is string => Boolean(fingerprint));
  const deadCodeFindings = deadCodeGate(context)
    .map((item) => item.fingerprint)
    .filter((fingerprint): fingerprint is string => Boolean(fingerprint));
  const baseline: QualityBaseline = { version: 1, metrics, findings, deadCodeFindings };
  writeFileSync(path, `${JSON.stringify(baseline, null, 2)}\n`);
  return [];
}

export function updateBaseline(context: QualityContext): QualityFinding[] {
  const path = resolve(context.root, ".quality/baseline.json");
  if (!existsSync(path))
    return [
      finding({
        code: "QG-BASELINE-003",
        gate: "baseline",
        severity: "error",
        title: "Baseline is missing",
        message: "Cannot ratchet a baseline that has not been initialized.",
        remediation: "Run quality:baseline:init once after correcting hard invariants.",
      }),
    ];
  const previous = JSON.parse(readFileSync(path, "utf8")) as QualityBaseline;
  const current = {
    ...collectMetrics({ ...context, mode: "full", files: context.files }),
    ...coverageBaselineMetrics(context),
  };
  const next: Record<string, Record<string, number>> = {};
  for (const [file, values] of Object.entries(current)) {
    const old = previous.metrics[file];
    next[file] = Object.fromEntries(
      Object.entries(values).map(([key, value]) => [key, old?.[key] === undefined ? value : Math.min(old[key], value)])
    );
  }
  const changed = JSON.stringify(next) !== JSON.stringify(previous.metrics);
  const currentDuplicateFingerprints = new Set(
    duplicationGate(context)
      .map((item) => item.fingerprint)
      .filter((fingerprint): fingerprint is string => Boolean(fingerprint))
  );
  const findings = (previous.findings ?? []).filter((fingerprint) => currentDuplicateFingerprints.has(fingerprint));
  const currentDeadCodeFingerprints = new Set(
    deadCodeGate(context)
      .map((item) => item.fingerprint)
      .filter((fingerprint): fingerprint is string => Boolean(fingerprint))
  );
  const deadCodeFindings = (previous.deadCodeFindings ?? []).filter((fingerprint) =>
    currentDeadCodeFingerprints.has(fingerprint)
  );
  if (
    !changed &&
    findings.length === (previous.findings ?? []).length &&
    deadCodeFindings.length === (previous.deadCodeFindings ?? []).length
  )
    return [];
  writeFileSync(
    path,
    `${JSON.stringify({ version: previous.version, metrics: next, findings, deadCodeFindings }, null, 2)}\n`
  );
  return [];
}

export function checkBaseline(context: QualityContext): QualityFinding[] {
  const path = resolve(context.root, ".quality/baseline.json");
  if (!existsSync(path))
    return [
      finding({
        code: "QG-BASELINE-003",
        gate: "baseline",
        severity: "error",
        title: "Baseline is missing",
        message: "Quality cannot enforce a ratchet without a versioned baseline.",
        remediation: "Run quality:baseline:init only after hard findings are corrected.",
      }),
    ];
  let previousText: string;
  try {
    previousText = execFileSync("git", ["show", `HEAD:.quality/baseline.json`], {
      cwd: context.root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch {
    return [];
  }
  const current = JSON.parse(readFileSync(path, "utf8")) as QualityBaseline;
  const previous = JSON.parse(previousText) as QualityBaseline;
  const findings: QualityFinding[] = [];
  for (const [file, values] of Object.entries(current.metrics)) {
    for (const [metric, value] of Object.entries(values)) {
      const old = previous.metrics[file]?.[metric];
      if (old !== undefined && value > old)
        findings.push(
          finding({
            code: "QG-BASELINE-001",
            gate: "baseline",
            severity: "error",
            path: file,
            title: "Baseline ratchet moved backwards",
            message: `${metric} increased from ${old} to ${value}.`,
            remediation:
              "Fix the debt or reduce the metric; never increase a threshold or baseline to make a feature pass.",
          })
        );
    }
  }
  for (const fingerprint of current.findings ?? []) {
    if (!(previous.findings ?? []).includes(fingerprint))
      findings.push(
        finding({
          code: "QG-BASELINE-001",
          gate: "baseline",
          severity: "error",
          title: "Baseline findings increased",
          message: `Baseline added an unrecognized finding fingerprint: ${fingerprint}`,
          remediation: "Fix the finding or keep the previous baseline fingerprint set unchanged.",
        })
      );
  }
  for (const fingerprint of current.deadCodeFindings ?? []) {
    if (!(previous.deadCodeFindings ?? []).includes(fingerprint))
      findings.push(
        finding({
          code: "QG-BASELINE-001",
          gate: "baseline",
          severity: "error",
          title: "Baseline findings increased",
          message: `Baseline added an unrecognized dead-code fingerprint: ${fingerprint}`,
          remediation: "Fix the finding or keep the previous baseline fingerprint set unchanged.",
        })
      );
  }
  return findings;
}

export function writeBaselineReport(context: QualityContext, findings: readonly QualityFinding[]): void {
  mkdirSync(context.reportsDirectory, { recursive: true });
  writeFileSync(join(context.reportsDirectory, "baseline.json"), `${JSON.stringify(findings, null, 2)}\n`);
}
