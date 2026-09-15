import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { sortFindings } from "./finding.js";
import type { QualityReport } from "./result.js";

export function printConsole(result: QualityReport): void {
  const findings = sortFindings(result.findings);
  if (findings.length === 0) {
    console.log(`Quality passed (${result.executed.length} gates).`);
    return;
  }
  for (const item of findings) {
    const location = item.path
      ? `${item.path}${item.line ? `:${item.line}${item.column ? `:${item.column}` : ""}` : ""}`
      : "";
    console.log(`\n${item.code} [${item.severity.toUpperCase()}]${location ? ` ${location}` : ""}`);
    console.log(`  ${item.title}`);
    console.log(`  ${item.message}`);
    for (const evidence of item.evidence ?? []) console.log(`  evidence: ${evidence}`);
    if (item.remediation) console.log(`  remediation: ${item.remediation}`);
  }
  console.log(`\nQuality found ${findings.length} finding(s) across ${result.executed.length} gate(s).`);
}

export function writeJsonReport(directory: string, name: string, result: QualityReport): string {
  mkdirSync(directory, { recursive: true });
  const path = join(directory, `${name}.json`);
  writeFileSync(
    path,
    `${JSON.stringify({ executed: result.executed, findings: sortFindings(result.findings) }, null, 2)}\n`
  );
  return path;
}
