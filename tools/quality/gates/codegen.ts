import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { QualityContext } from "../core/context.js";
import { finding, type QualityFinding } from "../core/finding.js";
import { runLocalBinary } from "../core/process.js";

const EMITTER_PATHS = ["packages/jit/src/compiler", "packages/jit/src/aot"];

export function codegenGate(context: QualityContext): QualityFinding[] {
  const findings: QualityFinding[] = [];
  for (const file of context.files) {
    if (
      !EMITTER_PATHS.some((root) => file.startsWith(`${root}/`)) ||
      !file.endsWith(".ts") ||
      file.includes("__tests__")
    )
      continue;
    const text = readFileSync(resolve(context.root, file), "utf8");
    const changed = context.changedFiles.includes(file);
    if (/\bfor\s*\([^)]*\bin\b/.test(text))
      findings.push(
        finding({
          code: "QG-CODEGEN-003",
          gate: "codegen",
          severity: changed ? "error" : "warning",
          path: file,
          title: "Emitter contains for-in enumeration",
          message: "Generated code must use known-shape or indexed traversal when the schema supplies the shape.",
          remediation:
            "Move dynamic enumeration out of the generated hot path or document the genuinely dynamic boundary.",
        })
      );
    if (emitsObjectKeys(text))
      findings.push(
        finding({
          code: "QG-CODEGEN-004",
          gate: "codegen",
          severity: changed ? "error" : "warning",
          path: file,
          title: "Emitter uses Object.keys",
          message: "Known schema shapes should emit direct property access.",
          remediation: "Use static property emission or isolate the dynamic operation outside generated code.",
        })
      );
    if (hasUnqualifiedFunctionCall(text))
      findings.push(
        finding({
          code: "QG-CODEGEN-002",
          gate: "codegen",
          severity: changed ? "error" : "warning",
          path: file,
          title: "Emitter retains a dynamic Function call",
          message: "Only the compilation boundary may create executable functions.",
          remediation:
            "Keep dynamic compilation at the explicit compiler boundary and emit ordinary source for the hot path.",
        })
      );
  }
  if (
    context.mode === "full" ||
    context.mode === "changed" ||
    (context.mode === "block" &&
      context.changedFiles.some((file) => EMITTER_PATHS.some((root) => file.startsWith(`${root}/`))))
  )
    findings.push(...runCodegenTests(context));
  return findings;
}

function emitsObjectKeys(source: string): boolean {
  return source.split("\n").some((line) => {
    if (!/\b(?:writer|this\.writer)\.line\s*\(/.test(line)) return false;
    return /Object\.keys\s*\(/.test(line);
  });
}

function hasUnqualifiedFunctionCall(source: string): boolean {
  return /(?<![\w$.])Function\s*\(/.test(source) && !/\bnew\s+Function\s*\(/.test(source);
}

function runCodegenTests(context: QualityContext): QualityFinding[] {
  const result = runLocalBinary(context.root, "vitest", [
    "run",
    "packages/jit/src/compiler/__tests__/generated-source-snapshots.test.ts",
    "packages/jit/src/compiler/__tests__/execution-optimize.test.ts",
    "packages/jit/src/compiler/__tests__/quality-codegen.test.ts",
    "packages/jit/src/__tests__/entrypoints.test.ts",
    "--reporter=dot",
  ]);
  if (result.status === 0) return [];
  return [
    finding({
      code: "QG-CODEGEN-001",
      gate: "codegen",
      severity: "error",
      title: "Code generation audit tests failed",
      message: `${result.stdout}\n${result.stderr}`.trim().slice(-4000),
      remediation: "Fix deterministic source, syntax, differential or runtime/AOT parity failures before continuing.",
    }),
  ];
}
