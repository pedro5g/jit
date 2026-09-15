import type { QualityContext } from "../core/context.js";
import { finding, type QualityFinding } from "../core/finding.js";
import { runLocalBinary } from "../core/process.js";

export function integrityGate(context: QualityContext): QualityFinding[] {
  const findings: QualityFinding[] = [];
  const files = context.files.filter((file) => file.endsWith(".ts") || file.endsWith(".tsx") || file.endsWith(".json"));
  if (files.length > 0 && context.mode !== "full") {
    for (const [binary, args] of [
      ["biome", ["check", ...files]],
      ["biome", ["lint", ...files]],
    ] as const) {
      const result = runLocalBinary(context.root, binary, args);
      if (result.status !== 0)
        findings.push(
          finding({
            code: binary === "biome" && args[0] === "check" ? "QG-INTEGRITY-001" : "QG-INTEGRITY-002",
            gate: "integrity",
            severity: "error",
            title: `${args[0]} failed`,
            message: `${result.stdout}\n${result.stderr}`.trim().slice(-4000),
            remediation: `Run pnpm ${args[0] === "check" ? "format" : "lint"} and inspect the resulting diff deliberately.`,
          })
        );
    }
  }
  if (context.mode === "full") {
    for (const [name, args] of [
      ["biome", ["check", "."]],
      ["biome", ["lint", "."]],
      ["tsc", ["--noEmit", "-p", "tsconfig.json"]],
      ["zshy", ["--project", "tsconfig.build.json"]],
    ] as const) {
      const result = runLocalBinary(context.root, name, args, {
        cwd: name === "zshy" ? `${context.root}/packages/jit` : context.root,
      });
      if (result.status !== 0)
        findings.push(
          finding({
            code: "QG-INTEGRITY-003",
            gate: "integrity",
            severity: "error",
            title: `${name} integrity check failed`,
            message: `${result.stdout}\n${result.stderr}`.trim().slice(-5000),
            remediation: "Fix the integrity check before evaluating downstream gates.",
          })
        );
    }
  }
  return findings;
}
