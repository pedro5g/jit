import type { QualityContext } from "./context.js";
import { finding, type QualityFinding, sortFindings } from "./finding.js";
import type { QualityReport } from "./result.js";
import type { QualityRule } from "./rule.js";

export interface QualityGate {
  readonly id: string;
  readonly tier: "A" | "B" | "C";
  readonly description: string;
  readonly run: (context: QualityContext) => QualityFinding[] | Promise<QualityFinding[]>;
}

export interface GateRunResult extends QualityReport {}

export async function runGates(context: QualityContext, gates: readonly QualityGate[]): Promise<GateRunResult> {
  const findings: QualityFinding[] = [];
  const executed: string[] = [];

  for (const gate of gates) {
    executed.push(gate.id);
    try {
      const rule = asQualityRule(gate);
      findings.push(...(await rule.evaluate(context)).map(finding));
    } catch (error) {
      findings.push(
        finding({
          code: "QG-INTERNAL-001",
          gate: gate.id,
          severity: "error",
          title: `Quality gate ${gate.id} failed to execute`,
          message: error instanceof Error ? error.message : String(error),
          remediation: `Fix the quality gate implementation or its input before continuing with this block.`,
        })
      );
    }
  }

  const sorted = sortFindings(findings);
  return { findings: sorted, passed: !sorted.some((item) => item.severity === "error"), executed };
}

function asQualityRule(gate: QualityGate): QualityRule {
  return {
    id: gate.id,
    description: gate.description,
    hard: gate.tier === "A",
    evaluate: gate.run,
  };
}
