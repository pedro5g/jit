import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { QualityContext } from "../core/context.js";
import { finding, type QualityFinding } from "../core/finding.js";
import { runLocalBinary } from "../core/process.js";

interface JscpdClone {
  readonly format?: string;
  readonly lines?: number;
  readonly tokens?: number;
  readonly firstFile?: {
    readonly name?: string;
    readonly start?: number | { readonly line?: number };
    readonly end?: number | { readonly line?: number };
    readonly startLoc?: { readonly line?: number };
    readonly endLoc?: { readonly line?: number };
  };
  readonly secondFile?: {
    readonly name?: string;
    readonly start?: number | { readonly line?: number };
    readonly end?: number | { readonly line?: number };
    readonly startLoc?: { readonly line?: number };
    readonly endLoc?: { readonly line?: number };
  };
}

type JscpdReport = { readonly duplicates?: readonly JscpdClone[] };

function lineOf(file: JscpdClone["firstFile"]): number {
  if (typeof file?.start === "number") return file.start;
  return file?.start?.line ?? file?.startLoc?.line ?? 0;
}

function pathOf(root: string, name: string | undefined): string {
  return name?.replace(`${root}/`, "").replaceAll("\\", "/") ?? "";
}

function fingerprintOf(
  first: string,
  second: string,
  firstLine: number,
  secondLine: number,
  clone: JscpdClone
): string {
  return [first, firstLine, second, secondLine, clone.lines ?? 0, clone.tokens ?? 0].join("|");
}

function legacyFingerprintOf(first: string, second: string, clone: JscpdClone): string {
  return fingerprintOf(first, second, 0, 0, clone);
}

function isKnownClone(
  baseline: QualityContext["baseline"],
  currentFingerprint: string,
  legacyFingerprint: string
): boolean {
  const findings = baseline?.findings ?? [];
  return findings.includes(currentFingerprint) || findings.includes(legacyFingerprint);
}

export function duplicationGate(context: QualityContext): QualityFinding[] {
  const reportPath = join(context.reportsDirectory, "jscpd-report.json");
  const result = runLocalBinary(context.root, "jscpd", [
    "--format",
    "typescript,javascript",
    "--reporters",
    "json",
    "--output",
    context.reportsDirectory,
    "--min-lines",
    String(context.config.thresholds.duplicateLines),
    "--min-tokens",
    String(context.config.thresholds.duplicateTokens),
    "packages",
    "apps",
    "tools",
    "tests",
  ]);
  if (result.status !== 0 && !existsSync(reportPath))
    return [
      finding({
        code: "QG-DUP-000",
        gate: "duplication",
        severity: "warning",
        title: "jscpd report could not be produced",
        message: result.stderr.trim() || result.stdout.trim() || "jscpd exited without a report.",
        remediation: "Keep jscpd installed and make the report path writable.",
      }),
    ];
  let report: JscpdReport;
  try {
    report = JSON.parse(readFileSync(reportPath, "utf8")) as { readonly duplicates?: readonly JscpdClone[] };
  } catch (error) {
    return [
      finding({
        code: "QG-DUP-002",
        gate: "duplication",
        severity: "error",
        title: "jscpd report is invalid",
        message: error instanceof Error ? error.message : String(error),
        remediation: "Regenerate the report with the configured jscpd version.",
      }),
    ];
  }
  return (report.duplicates ?? []).flatMap((clone) => {
    const first = pathOf(context.root, clone.firstFile?.name);
    const second = pathOf(context.root, clone.secondFile?.name);
    const firstLine = lineOf(clone.firstFile);
    const secondLine = lineOf(clone.secondFile);
    const fingerprint = fingerprintOf(first, second, firstLine, secondLine, clone);
    const known = isKnownClone(context.baseline, fingerprint, legacyFingerprintOf(first, second, clone));
    if (known) return [];
    const changed = context.changedFiles.some((file) => file === first || file === second);
    return [
      finding({
        code: "QG-DUP-001",
        gate: "duplication",
        severity: known || !context.baseline ? "warning" : changed ? "error" : "warning",
        ...(first ? { path: first } : {}),
        ...(firstLine ? { line: firstLine } : {}),
        title: "Relevant code duplication detected",
        message: `${first} duplicates ${second}.`,
        evidence: [`lines: ${clone.lines ?? "unknown"}`, `tokens: ${clone.tokens ?? "unknown"}`],
        remediation:
          "Reuse the existing abstraction or consolidate a table-driven test; do not add an ignore without a documented generated/fixture reason.",
        fingerprint,
      }),
    ];
  });
}
