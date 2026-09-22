import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { buildApiChallenges } from "./api/challenges.js";
import { apiCoherenceGate, buildApiInventory } from "./api/verifier.js";
import { collectPublicSymbols } from "./ast/exports.js";
import { collectFluentOperations } from "./ast/fluent.js";
import { collectImportEdges } from "./ast/imports.js";
import { createQualityContext, type QualityMode } from "./core/context.js";
import { type QualityGate, runGates } from "./core/gate.js";
import { runLocalBinary } from "./core/process.js";
import { checkBaseline, initializeBaseline, updateBaseline, writeBaselineReport } from "./core/ratchet.js";
import { printConsole, writeJsonReport } from "./core/reporter.js";
import { qualityResult } from "./core/result.js";
import { agentGate } from "./gates/agent.js";
import { apiChallengeGate } from "./gates/api-challenge.js";
import { architectureGate } from "./gates/architecture.js";
import { artifactGate } from "./gates/artifact.js";
import { codegenGate } from "./gates/codegen.js";
import { commentsGate } from "./gates/comments.js";
import { coverageGate } from "./gates/coverage.js";
import { deadCodeGate } from "./gates/dead-code.js";
import { duplicationGate } from "./gates/duplication.js";
import { integrityGate } from "./gates/integrity.js";
import { mutationGate } from "./gates/mutation.js";
import { packageGate } from "./gates/package.js";
import { protocolGate } from "./gates/protocol.js";
import { publicApiGate } from "./gates/public-api.js";
import { structureGate } from "./gates/structure.js";
import { testArchitectureGate } from "./gates/tests.js";

const root = resolve(new URL("../..", import.meta.url).pathname);

const GATES: Record<string, QualityGate> = {
  integrity: { id: "integrity", tier: "A", description: "format, lint, type and build integrity", run: integrityGate },
  architecture: {
    id: "architecture",
    tier: "A",
    description: "import graph, layers and cycles",
    run: architectureGate,
  },
  structure: {
    id: "structure",
    tier: "A",
    description: "logical size, complexity and god-module ratchets",
    run: structureGate,
  },
  duplication: { id: "duplication", tier: "B", description: "jscpd normalized clone detection", run: duplicationGate },
  "dead-code": { id: "dead-code", tier: "C", description: "Knip reachability audit", run: deadCodeGate },
  comments: { id: "comments", tier: "A", description: "implementation comment policy", run: commentsGate },
  "public-api": { id: "public-api", tier: "A", description: "public symbol inventory and JSDoc", run: publicApiGate },
  tests: { id: "tests", tier: "B", description: "Vitest setup and test architecture", run: testArchitectureGate },
  coverage: { id: "coverage", tier: "B", description: "coverage and changed-line ratchets", run: coverageGate },
  codegen: { id: "codegen", tier: "B", description: "source safety, determinism and parity tests", run: codegenGate },
  api: { id: "api", tier: "B", description: "fluent API grammar and transitions", run: apiCoherenceGate },
  "api-challenge": {
    id: "api-challenge",
    tier: "B",
    description: "semantic API challenge matrix",
    run: apiChallengeGate,
  },
  mutation: { id: "mutation", tier: "C", description: "Stryker changed and critical mutation flow", run: mutationGate },
  artifact: {
    id: "artifact",
    tier: "B",
    description: "portable artifact, manifest and standalone parity",
    run: artifactGate,
  },
  agent: {
    id: "agent",
    tier: "B",
    description: "declaration protocol and transport-neutral agent tools",
    run: agentGate,
  },
  package: {
    id: "package",
    tier: "B",
    description: "dist layout and publish tarball integrity",
    run: packageGate,
  },
  protocol: {
    id: "protocol",
    tier: "B",
    description: "explicit runtime/AOT protocol capability ownership",
    run: protocolGate,
  },
};

const command = process.argv[2] ?? "scan";
const argument = process.argv[3];

if (command === "context") {
  printContext(argument ?? "");
} else if (command === "explain") {
  printExplanation(argument ?? "");
} else if (command.startsWith("baseline:")) {
  await runBaseline(command.slice("baseline:".length));
} else {
  await runQuality(command, argument);
}

async function runQuality(commandName: string, argumentPath?: string): Promise<void> {
  const mode = modeFor(commandName);
  const context = createQualityContext(root, mode, argumentPath ? [argumentPath] : []);
  const preflightFindings =
    commandName === "coverage" || commandName === "tests" || commandName === "changed" || commandName === "full"
      ? runCoverage(context)
      : [];
  const gates = gatesFor(commandName, context);
  const result = await runGates(context, gates);
  const baselineFindings = checkBaseline(context);
  const combined = {
    ...qualityResult([...baselineFindings, ...preflightFindings, ...result.findings]),
    executed: ["baseline", ...result.executed],
    findings: [...baselineFindings, ...preflightFindings, ...result.findings],
  };
  mkdirSync(context.reportsDirectory, { recursive: true });
  writeJsonReport(context.reportsDirectory, commandName, combined);
  printConsole(combined);
  if (!combined.passed) process.exitCode = 1;
}

async function runBaseline(action: string): Promise<void> {
  const context = createQualityContext(root, "full");
  const findings =
    action === "init"
      ? initializeBaseline(context)
      : action === "update"
        ? updateBaseline(context)
        : action === "check"
          ? checkBaseline(context)
          : [unknownCommand(`baseline:${action}`)];
  writeBaselineReport(context, findings);
  const result = { ...qualityResult(findings), executed: ["baseline"] };
  printConsole(result);
  if (!result.passed) process.exitCode = 1;
}

function runCoverage(context: ReturnType<typeof createQualityContext>) {
  const result = runLocalBinary(context.root, "vitest", ["run", "--coverage"]);
  if (result.status === 0) return [];
  return [
    {
      code: "QG-COVERAGE-000",
      gate: "coverage",
      severity: "error" as const,
      title: "Coverage command failed",
      message: `${result.stdout}\n${result.stderr}`.trim().slice(-5000),
      remediation: "Fix the test or coverage failure before evaluating coverage ratchets.",
    },
  ];
}

function gatesFor(commandName: string, context: ReturnType<typeof createQualityContext>): QualityGate[] {
  const names: string[] =
    commandName === "arch"
      ? ["integrity", "architecture", "structure"]
      : commandName === "tests"
        ? ["tests", "coverage"]
        : commandName === "codegen"
          ? ["codegen"]
          : commandName === "artifact"
            ? ["artifact"]
            : commandName === "agent"
              ? ["agent"]
              : commandName === "package"
                ? ["package"]
                : commandName === "protocol"
                  ? ["protocol"]
                  : commandName === "api"
                    ? ["public-api", "api", "api-challenge"]
                    : commandName === "coverage"
                      ? ["coverage"]
                      : commandName === "changed"
                        ? [
                            "integrity",
                            "architecture",
                            "structure",
                            "duplication",
                            "dead-code",
                            "comments",
                            "public-api",
                            "tests",
                            "coverage",
                            "codegen",
                            "api",
                            "api-challenge",
                          ]
                        : commandName === "full" || commandName === "scan"
                          ? [
                              "integrity",
                              "architecture",
                              "structure",
                              "duplication",
                              "dead-code",
                              "comments",
                              "public-api",
                              "tests",
                              "coverage",
                              "codegen",
                              "api",
                              "api-challenge",
                              "artifact",
                              "agent",
                              "protocol",
                              "package",
                              "mutation",
                            ]
                          : commandName === "block"
                            ? relevantBlockGates(context)
                            : ["integrity", "architecture", "structure", "comments", "public-api", "api"];
  return names.map((name) => GATES[name]).filter((gate): gate is QualityGate => Boolean(gate));
}

function relevantBlockGates(context: ReturnType<typeof createQualityContext>): string[] {
  const files = context.files;
  const names = new Set(["integrity", "architecture", "structure", "comments", "public-api", "tests"]);
  if (files.some((file) => file.startsWith("packages/jit/src/compiler/") || file.startsWith("packages/jit/src/aot/")))
    names.add("codegen");
  if (files.some((file) => file.startsWith("packages/jit/src/aot/"))) names.add("artifact");
  if (files.some((file) => file.startsWith("packages/jit/src/tooling/") || file === "packages/jit/src/mcp.ts"))
    names.add("agent");
  if (
    files.some(
      (file) =>
        file.startsWith("packages/jit/src/aot/") ||
        file.startsWith("packages/jit/src/factories/") ||
        file.startsWith("packages/jit/src/compiler/")
    )
  )
    names.add("protocol");
  if (
    files.some(
      (file) =>
        file.startsWith("packages/jit/src/core/builder/") ||
        file.startsWith("packages/jit/src/factories/") ||
        file.startsWith("packages/jit/src/classes/")
    )
  )
    names.add("api");
  if (names.has("api")) names.add("api-challenge");
  if (files.some((file) => file.startsWith("docs/") || file.startsWith("apps/site/"))) names.add("dead-code");
  return [...names];
}

function modeFor(commandName: string): QualityMode {
  if (commandName === "staged") return "staged";
  if (commandName === "changed") return "changed";
  if (commandName === "block") return "block";
  return "full";
}

function unknownCommand(name: string) {
  return {
    code: "QG-CLI-001",
    gate: "cli",
    severity: "error" as const,
    title: "Unknown quality command",
    message: name,
    remediation: "Run pnpm quality for the supported command list.",
  };
}

function printContext(argumentPath: string): void {
  const context = createQualityContext(root, "block", argumentPath ? [argumentPath] : []);
  const inventory = buildApiInventory(context);
  const file = argumentPath.replaceAll("\\", "/");
  const imports = collectImportEdges(context).filter((edge) => edge.from === file);
  const publicSymbols = collectPublicSymbols(context).filter((symbol) => symbol.path === file);
  const fluent = collectFluentOperations(context).filter((operation) => operation.path === file);
  const layer =
    context.config.layers.find((item: { readonly patterns: readonly string[]; readonly name: string }) =>
      item.patterns.some((pattern: string) => matchPattern(file, pattern))
    )?.name ?? "unclassified";
  console.log(
    JSON.stringify(
      {
        path: file,
        layer,
        applicableGates: gatesFor("block", context).map((gate) => gate.id),
        imports,
        publicSymbols,
        fluentOperations: fluent,
        relatedContracts: inventory.contracts.filter((contract) => fluent.some((item) => item.name === contract.name)),
        apiChallenges: buildApiChallenges(inventory.contracts).map((challenge) => ({
          id: challenge.id,
          kind: challenge.kind,
          sequence: challenge.sequence,
          question: challenge.question,
          expected: challenge.expected,
          actual: challenge.actual,
          status: challenge.status,
        })),
        baselineDebt: context.baseline?.metrics[file] ?? null,
      },
      null,
      2
    )
  );
}

function printExplanation(code: string): void {
  const explanations: Readonly<Record<string, { readonly title: string; readonly remediation: string }>> = {
    "QG-API-001": {
      title: "Public fluent operation has no semantic contract",
      remediation:
        "Add the operation to the API contract model and declare its requirements, provided capabilities, repeat semantics, conflicts and terminal behavior.",
    },
    "QG-API-002": {
      title: "Fluent operation transition is invalid",
      remediation:
        "Inspect the previous semantic state and either change the chain or add an explicit contract for the intended transition.",
    },
    "QG-API-003": {
      title: "Repeated singleton transition",
      remediation:
        "Keep the singleton operation once, or introduce an explicit replacement contract when replacement has real semantics.",
    },
    "QG-API-CHALLENGE-001": {
      title: "API semantic decision is not explicit",
      remediation:
        "Answer the challenge in the API grammar: decide whether the sequence is valid, redundant, exclusive, terminal, accumulated or fused, then prove the decision in the type and runtime surfaces.",
    },
    "QG-API-CHALLENGE-002": {
      title: "API semantic challenge failed",
      remediation:
        "Fix the grammar, type surface and runtime implementation so the declared semantic decision is deterministic before continuing the block.",
    },
    "QG-ARCH-001": {
      title: "Forbidden architecture dependency",
      remediation:
        "Move the dependency behind an allowed lower-layer boundary or reuse an existing shared abstraction.",
    },
    "QG-CODEGEN-001": {
      title: "Code generation audit failed",
      remediation: "Fix deterministic source, syntax, differential behavior or runtime/AOT parity before continuing.",
    },
    "QG-COVERAGE-002": {
      title: "Changed executable lines are uncovered",
      remediation: "Add a behavioral test for the changed branch; do not add a line-only test.",
    },
  };
  const explanation = explanations[code];
  if (!explanation) {
    console.log(`No explanation is registered for ${code}. Inspect .quality/reports for the complete finding.`);
    return;
  }
  console.log(`${code}\n\n${explanation.title}\n\nRemediation:\n${explanation.remediation}`);
}

function matchPattern(value: string, pattern: string): boolean {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replaceAll("**", "@@DOUBLE@@")
    .replaceAll("*", "[^/]*")
    .replaceAll("@@DOUBLE@@", ".*");
  return new RegExp(`^${escaped}$`).test(value);
}
