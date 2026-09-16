import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { QualityContext } from "../core/context.js";
import { finding, type QualityFinding } from "../core/finding.js";
import { runLocalBinary } from "../core/process.js";

export function mutationGate(context: QualityContext): QualityFinding[] {
  if (!existsSync(resolve(context.root, "stryker.config.mjs")))
    return [
      finding({
        code: "QG-MUTATION-001",
        gate: "mutation",
        severity: "error",
        title: "Stryker configuration is missing",
        message: "The mutation gate has no reproducible configuration.",
        remediation: "Add changed, critical and full mutation configurations with a stable test command.",
      }),
    ];
  if (process.env.QUALITY_RUN_MUTATION !== "1")
    return [
      finding({
        code: "QG-MUTATION-002",
        gate: "mutation",
        severity: "warning",
        title: "Mutation execution was not requested",
        message: "The configured mutation runner was not started for this quality pass.",
        remediation: "Run pnpm test:mutation:changed or set QUALITY_RUN_MUTATION=1 for the full critical gate.",
      }),
    ];
  const args =
    context.mode === "full"
      ? ["run", "stryker.config.mjs"]
      : [
          "run",
          "stryker.config.mjs",
          "--mutate",
          context.changedFiles.filter((file) => file.endsWith(".ts")).join(","),
        ];
  const result = runLocalBinary(context.root, "stryker", args);
  if (result.status === 0) return mutationReportFindings(context);
  return [
    finding({
      code: "QG-MUTATION-003",
      gate: "mutation",
      severity: "error",
      title: "Mutation testing found surviving mutants",
      message: `${result.stdout}\n${result.stderr}`.trim().slice(-5000),
      remediation:
        "Add or strengthen a behavioral test for the surviving mutation, especially for boundaries, guards, parity and repeat protection.",
    }),
  ];
}

function mutationReportFindings(context: QualityContext): QualityFinding[] {
  const reportPath = resolve(context.root, ".quality/reports/mutation.json");
  if (!existsSync(reportPath))
    return [
      finding({
        code: "QG-MUTATION-004",
        gate: "mutation",
        severity: "error",
        title: "Mutation report is missing",
        message: "Stryker completed without writing its configured JSON report.",
        remediation: "Keep jsonReporter.fileName under .quality/reports and inspect the Stryker configuration.",
      }),
    ];
  try {
    const report = JSON.parse(readFileSync(reportPath, "utf8")) as {
      readonly files?: Readonly<Record<string, { readonly mutants?: readonly { readonly status?: string }[] }>>;
    };
    const mutants = Object.values(report.files ?? {}).flatMap((file) => file.mutants ?? []);
    const active = mutants.filter((mutant) => mutant.status !== "Ignored");
    const killed = active.filter((mutant) => mutant.status === "Killed").length;
    const score = active.length === 0 ? 100 : (killed / active.length) * 100;
    if (score >= context.config.thresholds.criticalMutation) return [];
    return [
      finding({
        code: "QG-MUTATION-005",
        gate: "mutation",
        severity: "error",
        title: "Mutation score is below the critical target",
        message: `Mutation score is ${score.toFixed(2)}%; target is ${context.config.thresholds.criticalMutation}%.`,
        evidence: [`active mutants: ${active.length}`, `killed: ${killed}`],
        remediation: "Add behavioral coverage for the surviving or timed-out mutant before continuing.",
      }),
    ];
  } catch (error) {
    return [
      finding({
        code: "QG-MUTATION-004",
        gate: "mutation",
        severity: "error",
        title: "Mutation report is invalid",
        message: error instanceof Error ? error.message : String(error),
        remediation: "Regenerate the report with the configured Stryker version.",
      }),
    ];
  }
}
