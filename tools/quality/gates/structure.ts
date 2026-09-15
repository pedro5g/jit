import type { QualityContext } from "../core/context.js";
import { finding, type QualityFinding } from "../core/finding.js";
import { collectMetrics, type FileMetrics } from "../core/metrics.js";
import { isTestFile } from "../core/paths.js";

export function structureGate(context: QualityContext): QualityFinding[] {
  const metrics = collectMetrics(context);
  const findings: QualityFinding[] = [];
  for (const [path, current] of Object.entries(metrics)) {
    const threshold = isTestFile(path)
      ? context.config.thresholds.testLogicalLoc
      : context.config.thresholds.productionLogicalLoc;
    const previous = context.baseline?.metrics[path];
    const isNew = !previous;
    if (current.logicalLoc > threshold && (isNew || current.logicalLoc > (previous?.logicalLoc ?? 0))) {
      findings.push(
        finding({
          code: "QG-SIZE-001",
          gate: "structure",
          severity: isNew ? "error" : "warning",
          path,
          title: "File exceeds the logical LOC target",
          message: `${current.logicalLoc} logical lines exceed the ${threshold} line target.`,
          evidence: [`previous baseline: ${previous?.logicalLoc ?? "none"}`],
          remediation: "Split by responsibility after identifying the module boundary; do not split mechanically.",
        })
      );
    }
    if (
      current.maxFunctionLoc > context.config.thresholds.functionLogicalLoc &&
      (isNew || current.maxFunctionLoc > (previous?.maxFunctionLoc ?? 0))
    ) {
      findings.push(
        finding({
          code: "QG-SIZE-002",
          gate: "structure",
          severity: isNew ? "error" : "warning",
          path,
          title: "Function exceeds the logical LOC target",
          message: `${current.maxFunctionLoc} lines in the largest function exceed the ${context.config.thresholds.functionLogicalLoc} line target.`,
          remediation:
            "Extract a responsibility-preserving helper or document why the specialized hot path must remain together.",
        })
      );
    }
    if (
      current.maxComplexity > context.config.thresholds.complexity &&
      (isNew || current.maxComplexity > (previous?.maxComplexity ?? 0))
    ) {
      findings.push(
        finding({
          code: "QG-SIZE-003",
          gate: "structure",
          severity: isNew ? "error" : "warning",
          path,
          title: "Cyclomatic complexity increased beyond the target",
          message: `Maximum measured complexity is ${current.maxComplexity}; target is ${context.config.thresholds.complexity}.`,
          remediation: "Reduce branching or split the decision into a focused plan/helper.",
        })
      );
    }
    if (
      current.maxNesting > context.config.thresholds.nesting &&
      (isNew || current.maxNesting > (previous?.maxNesting ?? 0))
    ) {
      findings.push(
        finding({
          code: "QG-SIZE-004",
          gate: "structure",
          severity: isNew ? "error" : "warning",
          path,
          title: "Nesting exceeds the target",
          message: `Maximum measured nesting is ${current.maxNesting}; target is ${context.config.thresholds.nesting}.`,
          remediation: "Use guard clauses or extract the nested branch into a named operation.",
        })
      );
    }
    const god = godModule(current);
    if (god !== "healthy" && (isNew || exceedsGodBaseline(current, previous))) {
      findings.push(
        finding({
          code: god === "blocked" ? "QG-SIZE-006" : "QG-SIZE-005",
          gate: "structure",
          severity: god === "blocked" && isNew ? "error" : "warning",
          path,
          title: `God-module heuristic classified this file as ${god}`,
          message: `The file combines ${current.imports} imports, ${current.exports} exports, ${current.functions} functions and ${current.logicalLoc} logical lines.`,
          remediation: "Review responsibility clusters, public surface, and fan-out before adding another concern.",
        })
      );
    }
  }
  return findings;
}

function godModule(metrics: FileMetrics): "healthy" | "watch" | "legacy-debt" | "blocked" {
  const score =
    Number(metrics.logicalLoc > 1200) +
    Number(metrics.imports > 35) +
    Number(metrics.exports > 30) +
    Number(metrics.functions > 70) +
    Number(metrics.maxComplexity > 35);
  if (score >= 4) return "blocked";
  if (score >= 3) return "legacy-debt";
  if (score >= 2) return "watch";
  return "healthy";
}

function exceedsGodBaseline(current: FileMetrics, previous: Readonly<Record<string, number>> | undefined): boolean {
  if (!previous) return true;
  return (
    current.logicalLoc > (previous.logicalLoc ?? 0) ||
    current.functions > (previous.functions ?? 0) ||
    current.imports > (previous.imports ?? 0) ||
    current.exports > (previous.exports ?? 0)
  );
}
