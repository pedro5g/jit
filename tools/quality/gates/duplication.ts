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
    readonly start?: { readonly line?: number };
    readonly end?: { readonly line?: number };
  };
  readonly secondFile?: {
    readonly name?: string;
    readonly start?: { readonly line?: number };
    readonly end?: { readonly line?: number };
  };
}

export function duplicationGate(context: QualityContext): QualityFinding[] {
  const reportPath = join(context.reportsDirectory, "jscpd-report.json");
  if (!existsSync(reportPath)) {
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
  }
  let report: { readonly duplicates?: readonly JscpdClone[] };
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
    const first = clone.firstFile?.name?.replace(`${context.root}/`, "").replaceAll("\\", "/") ?? "";
    const second = clone.secondFile?.name?.replace(`${context.root}/`, "").replaceAll("\\", "/") ?? "";
    const fingerprint = [
      first,
      clone.firstFile?.start?.line ?? 0,
      second,
      clone.secondFile?.start?.line ?? 0,
      clone.lines ?? 0,
      clone.tokens ?? 0,
    ].join("|");
    const known = context.baseline?.findings?.includes(fingerprint) ?? false;
    const changed = context.changedFiles.some((file) => file === first || file === second);
    return [
      finding({
        code: "QG-DUP-001",
        gate: "duplication",
        severity: known || !context.baseline ? "warning" : changed ? "error" : "warning",
        ...(first ? { path: first } : {}),
        ...(clone.firstFile?.start?.line ? { line: clone.firstFile.start.line } : {}),
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
