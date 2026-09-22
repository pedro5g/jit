import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { QualityContext } from "../core/context.js";
import { finding, type QualityFinding } from "../core/finding.js";
import { runLocalBinary } from "../core/process.js";

const REQUIRED_FILES = [
  "packages/jit/src/tooling/declaration-protocol.ts",
  "packages/jit/src/tooling/agent-tool-core.ts",
  "packages/jit/src/tooling/adapters.ts",
  "packages/jit/src/tooling/artifact-tools.ts",
  "packages/jit/src/tooling/model-tools.ts",
] as const;

/** Checks revisioned declarations, shared tools and transport adapters. */
export function agentGate(context: QualityContext): QualityFinding[] {
  const missing = REQUIRED_FILES.filter((file) => !existsSync(resolve(context.root, file)));
  if (missing.length > 0) return [missingFinding(missing)];

  const source = readAgentSources(context.root);
  return [...checkTrustRules(source), ...checkSourceBoundary(source), ...runAgentTests(context)];
}

function missingFinding(missing: readonly string[]): QualityFinding {
  return finding({
    code: "QG-AGENT-001",
    gate: "agent",
    severity: "error",
    title: "Agent tool core is incomplete",
    message: `Missing: ${missing.join(", ")}`,
    remediation: "Keep declaration, artifact and transport concerns behind AgentToolCore.",
  });
}

interface AgentSources {
  readonly artifactTools: string;
  readonly modelTests: string;
  readonly artifactTests: string;
}

function readAgentSources(root: string): AgentSources {
  const file = (path: string): string => readFileSync(resolve(root, path), "utf8");
  return {
    artifactTools: file("packages/jit/src/tooling/artifact-tools.ts"),
    modelTests: file("packages/jit/src/tooling/__tests__/declaration-protocol.test.ts"),
    artifactTests: file("packages/jit/src/tooling/__tests__/artifact-tools.test.ts"),
  };
}

function checkTrustRules(source: AgentSources): QualityFinding[] {
  const findings: QualityFinding[] = [];
  if (!source.artifactTools.includes('result.status !== "clean"')) {
    findings.push(
      finding({
        code: "QG-AGENT-002",
        gate: "agent",
        severity: "error",
        path: "packages/jit/src/tooling/artifact-tools.ts",
        title: "Agent lookup can trust stale manifest metadata",
        message: "Semantic artifact tools must fail closed unless managed metadata is clean.",
        remediation: "Require inspectArtifactStatus(...).status === clean before describing a managed artifact.",
      })
    );
  }
  if (!source.modelTests.includes("RevisionConflictError")) {
    findings.push(
      finding({
        code: "QG-AGENT-003",
        gate: "agent",
        severity: "error",
        path: "packages/jit/src/tooling/__tests__/declaration-protocol.test.ts",
        title: "Revision-conflict coverage is missing",
        message: "Writes must reject a stale base revision without applying a partial model update.",
        remediation: "Keep a REVISION_CONFLICT regression test around applyDeclarationPatch.",
      })
    );
  }
  return findings;
}

function checkSourceBoundary(source: AgentSources): QualityFinding[] {
  return source.artifactTests.includes("jit_source_read") || source.artifactTools.includes("jit_source_read")
    ? []
    : [
        finding({
          code: "QG-AGENT-004",
          gate: "agent",
          severity: "error",
          path: "packages/jit/src/tooling/artifact-tools.ts",
          title: "Source retrieval is not separated from semantic lookup",
          message: "Source reads must remain an explicit debugging operation rather than a lookup fallback.",
          remediation: "Expose jit_source_read separately and keep semantic tools manifest-only.",
        }),
      ];
}

function runAgentTests(context: QualityContext): QualityFinding[] {
  const result = runLocalBinary(context.root, "vitest", [
    "run",
    "packages/jit/src/tooling/__tests__",
    "packages/jit/src/__tests__/mcp.test.ts",
    "--reporter=dot",
  ]);
  return result.status === 0
    ? []
    : [
        finding({
          code: "QG-AGENT-002",
          gate: "agent",
          severity: "error",
          title: "Agent protocol tests failed",
          message: `${result.stdout}\n${result.stderr}`.trim().slice(-5000),
          remediation: "Fix revision conflicts, clean-manifest trust rules and shared MCP/WebMCP/Lab tool behavior.",
        }),
      ];
}
