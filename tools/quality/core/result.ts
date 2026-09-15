import type { QualityFinding } from "./finding.js";

export interface QualityResult {
  readonly findings: readonly QualityFinding[];
  readonly passed: boolean;
}

export interface QualityReport extends QualityResult {
  readonly executed: readonly string[];
}

export function qualityResult(findings: readonly QualityFinding[]): QualityResult {
  return { findings, passed: !findings.some((item) => item.severity === "error") };
}
