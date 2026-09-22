import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { QualityContext } from "../core/context.js";
import { finding, type QualityFinding } from "../core/finding.js";
import { runLocalBinary } from "../core/process.js";

interface ProtocolPaths {
  readonly execution: string;
  readonly runtimeOps: string;
  readonly artifactFixture: string;
  readonly generator: string;
}

/** Checks that protocol capabilities are explicit and attached to matching boundaries. */
export function protocolGate(context: QualityContext): QualityFinding[] {
  const paths = protocolPaths(context.root);
  const missing = Object.values(paths).filter((path) => !existsSync(path));
  if (missing.length > 0) return [missingFinding(context.root, missing)];

  const source = {
    execution: readFileSync(paths.execution, "utf8"),
    runtimeOps: readFileSync(paths.runtimeOps, "utf8"),
    artifact: readFileSync(paths.artifactFixture, "utf8"),
    generator: readFileSync(paths.generator, "utf8"),
  };
  return [
    ...checkRuntimeOwnership(source.execution, source.runtimeOps),
    ...checkParity(source.artifact),
    ...checkStandalone(source.generator),
    ...checkManifestCoverage(source.artifact),
    ...runProtocolTests(context),
  ];
}

function protocolPaths(root: string): ProtocolPaths {
  const path = (value: string): string => resolve(root, value);
  return {
    execution: path("packages/jit/src/factories/execution.ts"),
    runtimeOps: path("packages/jit/src/factories/runtime-ops.ts"),
    artifactFixture: path("packages/jit/src/aot/__tests__/artifact-contracts.test.ts"),
    generator: path("packages/jit/src/aot/generate.ts"),
  };
}

function missingFinding(root: string, missing: readonly string[]): QualityFinding {
  return finding({
    code: "QG-PROTOCOL-001",
    gate: "protocol",
    severity: "error",
    title: "Protocol ownership audit is incomplete",
    message: `Missing: ${missing.map((path) => path.slice(root.length + 1)).join(", ")}`,
    remediation: "Keep runtime boundary ownership and AOT protocol coverage in the same audit block.",
  });
}

function checkRuntimeOwnership(execution: string, runtimeOps: string): QualityFinding[] {
  const findings: QualityFinding[] = [];
  if (!execution.includes("standard") || !execution.includes("parse")) {
    findings.push(
      finding({
        code: "QG-PROTOCOL-001",
        gate: "protocol",
        severity: "error",
        path: "packages/jit/src/factories/execution.ts",
        title: "Protocol is not attached at its semantic boundary",
        message: "The parse boundary must own the unknown-to-output Standard Schema contract.",
        remediation: "Attach Standard Schema only to the callable whose input/output matches it.",
      })
    );
  }
  if (runtimeOps.includes("StandardSchemaV1") && runtimeOps.includes("safeParse")) {
    findings.push(
      finding({
        code: "QG-PROTOCOL-002",
        gate: "protocol",
        severity: "error",
        path: "packages/jit/src/factories/runtime-ops.ts",
        title: "Incompatible callable boundary exposes Standard Schema",
        message: "Boolean is and SafeParseResult callables are not Standard Schema adapters by themselves.",
        remediation: "Keep the Standard Schema interface on parse and expose other result modes structurally.",
      })
    );
  }
  return findings;
}

function checkParity(source: string): QualityFinding[] {
  return source.includes("runtime/AOT") || source.includes("~standard")
    ? []
    : [
        finding({
          code: "QG-PROTOCOL-003",
          gate: "protocol",
          severity: "error",
          path: "packages/jit/src/aot/__tests__/artifact-contracts.test.ts",
          title: "Runtime/AOT protocol parity coverage is missing",
          message: "Selected Standard Schema capabilities need a generated structural behavior assertion.",
          remediation: "Cover the emitted adapter and its manifest capability in the AOT fixture.",
        }),
      ];
}

function checkStandalone(source: string): QualityFinding[] {
  return source.includes('from "@jit-compiler/')
    ? [
        finding({
          code: "QG-PROTOCOL-004",
          gate: "protocol",
          severity: "error",
          path: "packages/jit/src/aot/generate.ts",
          title: "Portable protocol output imports JIT runtime",
          message: "Generated protocol adapters must be structural and standalone.",
          remediation: "Inline the selected adapter and keep JIT imports outside generated modules.",
        }),
      ]
    : [];
}

function checkManifestCoverage(source: string): QualityFinding[] {
  return source.includes("protocols:") && source.includes("standard-json-schema/v1")
    ? []
    : [
        finding({
          code: "QG-PROTOCOL-005",
          gate: "protocol",
          severity: "error",
          path: "packages/jit/src/aot/__tests__/artifact-contracts.test.ts",
          title: "Selected protocol capability has no manifest coverage",
          message: "Protocol metadata must be emitted only when requested and remain discoverable in the manifest.",
          remediation: "Assert both Standard Schema and Standard JSON Schema selection in the manifest fixture.",
        }),
      ];
}

function runProtocolTests(context: QualityContext): QualityFinding[] {
  const result = runLocalBinary(context.root, "vitest", [
    "run",
    "packages/jit/src/factories/__tests__/standard-schema.test.ts",
    "packages/jit/src/aot/__tests__/artifact-contracts.test.ts",
    "--reporter=dot",
  ]);
  return result.status === 0
    ? []
    : [
        finding({
          code: "QG-PROTOCOL-003",
          gate: "protocol",
          severity: "error",
          title: "Protocol parity tests failed",
          message: `${result.stdout}\n${result.stderr}`.trim().slice(-5000),
          remediation: "Fix runtime/AOT capability ownership and structural adapter behavior before continuing.",
        }),
      ];
}
