import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { QualityContext } from "../core/context.js";
import { finding, type QualityFinding } from "../core/finding.js";

interface CoverageFile {
  readonly path?: string;
  readonly statementMap?: Readonly<
    Record<string, { readonly start: { readonly line: number }; readonly end: { readonly line: number } }>
  >;
  readonly s?: Readonly<Record<string, number>>;
  readonly branchMap?: Readonly<
    Record<string, { readonly locations?: readonly { readonly start: { readonly line: number } }[] }>
  >;
  readonly b?: Readonly<Record<string, readonly number[]>>;
}

export function coverageGate(context: QualityContext): QualityFinding[] {
  const report = resolveCoverageReport(context);
  if (!report)
    return context.mode === "full" || context.mode === "changed"
      ? [
          finding({
            code: "QG-COVERAGE-001",
            gate: "coverage",
            severity: "error",
            title: "Coverage report is missing",
            message: "The quality gate requires coverage-final.json or coverage-summary.json.",
            remediation: "Run pnpm test:coverage before evaluating coverage ratchets.",
          }),
        ]
      : [];
  const findings: QualityFinding[] = [];
  for (const [file, data] of Object.entries(report)) {
    const path = normalizeCoveragePath(context, file, data);
    const previous = context.baseline?.metrics[`coverage:${path}`];
    const current = coverageMetrics(data);
    if (previous && current.lines < (previous.lines ?? 0))
      findings.push(
        finding({
          code: "QG-COVERAGE-003",
          gate: "coverage",
          severity: "error",
          path,
          title: "Coverage ratchet decreased",
          message: `Lines coverage fell from ${previous.lines}% to ${current.lines}%.`,
          remediation: "Restore the missing behavioral coverage or remove the changed code.",
        })
      );
    if (context.mode === "block" || context.mode === "changed") {
      const ranges = context.changedRanges.get(path) ?? [];
      const missing = executableLines(data).filter(
        (line) => ranges.some((range) => line >= range.start && line <= range.end) && !coveredLine(data, line)
      );
      if (missing.length > 0)
        findings.push(
          finding({
            code: "QG-COVERAGE-002",
            gate: "coverage",
            severity: "error",
            path,
            title: "Changed executable lines are uncovered",
            message: `${missing.length} changed executable line(s) are not covered.`,
            evidence: [missing.join(", ")],
            remediation: "Add a behavioral test for the changed branch; do not add a line-only test.",
          })
        );
    }
  }
  return findings;
}

export function coverageBaselineMetrics(context: QualityContext): Record<string, Record<string, number>> {
  const report = resolveCoverageReport(context);
  if (!report) return {};
  return Object.fromEntries(
    Object.entries(report).map(([file, data]) => {
      const path = normalizeCoveragePath(context, file, data);
      return [`coverage:${path}`, coverageMetrics(data)];
    })
  );
}

function resolveCoverageReport(context: QualityContext): Record<string, CoverageFile> | undefined {
  const file = resolve(context.root, "coverage/coverage-final.json");
  if (existsSync(file)) return JSON.parse(readFileSync(file, "utf8")) as Record<string, CoverageFile>;
  return undefined;
}

function normalizeCoveragePath(context: QualityContext, key: string, data: CoverageFile): string {
  const value = data.path ?? key;
  return value.startsWith(context.root)
    ? value.slice(context.root.length + 1).replaceAll("\\", "/")
    : value.replaceAll("\\", "/");
}

function executableLines(data: CoverageFile): number[] {
  return Object.values(data.statementMap ?? {})
    .map((range) => range.start.line)
    .sort((left, right) => left - right);
}

function coveredLine(data: CoverageFile, line: number): boolean {
  return Object.entries(data.statementMap ?? {}).some(
    ([id, range]) => range.start.line === line && (data.s?.[id] ?? 0) > 0
  );
}

function coverageMetrics(data: CoverageFile): {
  readonly lines: number;
  readonly statements: number;
  readonly branches: number;
} {
  const statements = Object.keys(data.s ?? {});
  const coveredStatements = statements.filter((id) => (data.s?.[id] ?? 0) > 0).length;
  const branches = Object.values(data.b ?? {}).flat();
  return {
    lines: statements.length === 0 ? 100 : (coveredStatements / statements.length) * 100,
    statements: statements.length === 0 ? 100 : (coveredStatements / statements.length) * 100,
    branches: branches.length === 0 ? 100 : (branches.filter((count) => count > 0).length / branches.length) * 100,
  };
}
