import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { QualityContext } from "../core/context.js";
import { finding, type QualityFinding } from "../core/finding.js";

/** Checks the contract-first environment, optimizer, extension and evidence boundaries. */
export function adaptiveGate(context: QualityContext): QualityFinding[] {
  const root = context.root;
  const source = (file: string): string => {
    const path = resolve(root, file);
    return existsSync(path) ? readFileSync(path, "utf8") : "";
  };
  const findings: QualityFinding[] = [];
  const host = source("packages/jit/src/core/host.ts");
  const validation = source("packages/jit/src/compiler/validate.ts");
  const registry = source("packages/jit/src/core/registry/registry.ts");
  const artifactProgram = source("packages/jit/src/aot/build-artifact-program.ts");
  const extensions = source("packages/jit/src/extensions/extension-ir.ts");
  const plugin = source("packages/jit/src/extensions/plugin.ts");
  const physical = source("packages/jit/src/compiler/physical/physical-plan.ts");
  const strategy = source("packages/jit/src/compiler/strategy/family.ts");
  const assumptions = source("perf/assumptions/index.ts");

  const forbidden = [
    [
      host,
      ["OptimizationLevel", "PerformanceHints"],
      "QG-CONFIG-001",
      "public optimization controls remain in the host contract",
    ],
    [
      validation,
      ["config.locale", "getDefaultEnvironment().config.locale"],
      "QG-CONFIG-002",
      "presentation configuration reaches validator compilation",
    ],
    [extensions, ["CodeWriter", "raw JavaScript"], "QG-EXT-001", "extension contracts expose an emitter boundary"],
  ] as const;
  for (const [content, tokens, code, message] of forbidden) {
    if (tokens.some((token) => content.includes(token))) findings.push(contractFinding(code, message));
  }

  const required = [
    [registry, "RegistryDuplicateIdError", "QG-REGISTRY-001", "registry duplicate-id protection is missing"],
    [
      artifactProgram,
      "stripDescriptiveMetadata",
      "QG-REGISTRY-002",
      "descriptive metadata is not excluded from declaration fingerprints",
    ],
    [plugin, "version", "QG-EXT-002", "plugin identity does not carry version and ABI"],
    [plugin, "abi", "QG-EXT-002", "plugin identity does not carry version and ABI"],
    [plugin, "ExtensionGrammar", "QG-EXT-003", "extension semantics do not declare API grammar"],
    [physical, "digest", "QG-OPT-003", "physical planning has no deterministic target fallback"],
    [physical, "resolveTargetProfile", "QG-OPT-003", "physical planning has no deterministic target fallback"],
    [strategy, "evidence", "QG-PERF-001", "strategy families do not require evidence identifiers"],
  ] as const;
  for (const [content, token, code, message] of required) {
    if (!content.includes(token)) findings.push(contractFinding(code, message));
  }
  if (!/^\s*id:\s*"PERF-/m.test(assumptions))
    findings.push(contractFinding("QG-PERF-002", "performance assumption registry is missing evidence ids"));
  return findings;
}

function contractFinding(code: string, message: string): QualityFinding {
  return finding({
    code,
    gate: "adaptive",
    severity: "error",
    title: "Contract-first compiler invariant failed",
    message,
    remediation: "Restore the semantic/physical boundary and add a focused regression before continuing.",
  });
}
