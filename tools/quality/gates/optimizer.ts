import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { QualityContext } from "../core/context.js";
import { finding, type QualityFinding } from "../core/finding.js";

/** Verifies strategy, target, evidence and extension lowering boundaries. */
export function optimizerGate(context: QualityContext): QualityFinding[] {
  const read = (file: string): string => {
    const path = resolve(context.root, file);
    return existsSync(path) ? readFileSync(path, "utf8") : "";
  };
  const sources = {
    arrayEmitter: read("packages/jit/src/compiler/validate/emit-validate-collections.ts"),
    enumEmitter: read("packages/jit/src/compiler/validate/emit-validate.ts"),
    candidate: read("packages/jit/src/compiler/strategy/candidate.ts"),
    strategy: read("packages/jit/src/compiler/strategy/family.ts"),
    catalog: read("packages/jit/src/compiler/strategy/catalog.ts"),
    physical: read("packages/jit/src/compiler/physical/physical-plan.ts"),
    aot: read("packages/jit/src/aot/generate.ts"),
    manifest: read("packages/jit/src/aot/artifact-manifest.ts"),
    extensionLowering: read("packages/jit/src/compiler/extension-lowering.ts"),
    performanceProfile: read("packages/jit/src/compiler/performance/profile.ts"),
    assumptions: read("perf/assumptions/index.ts"),
    evidence: read("perf/evidence/index.ts"),
  };
  return [...strategyFindings(sources), ...evidenceFindings(sources)];
}

interface OptimizerSources {
  readonly arrayEmitter: string;
  readonly enumEmitter: string;
  readonly candidate: string;
  readonly strategy: string;
  readonly catalog: string;
  readonly physical: string;
  readonly aot: string;
  readonly manifest: string;
  readonly extensionLowering: string;
  readonly performanceProfile: string;
  readonly assumptions: string;
  readonly evidence: string;
}

function strategyFindings(source: OptimizerSources): QualityFinding[] {
  const required = [
    [
      source.arrayEmitter,
      "resolveArrayValidationStrategy",
      "QG-OPT-001",
      "array validation bypasses its strategy family",
    ],
    [source.physical, "resolveTupleValidationStrategy", "QG-OPT-001", "tuple validation bypasses its strategy family"],
    [source.enumEmitter, "resolveEnumMembershipStrategy", "QG-OPT-001", "enum validation bypasses its strategy family"],
    [source.candidate, "legality(context", "QG-OPT-002", "strategy candidates do not declare semantic legality"],
    [
      source.strategy,
      "candidate.optimized && candidate.evidence.length === 0",
      "QG-OPT-003",
      "optimized strategies can omit evidence",
    ],
    [source.catalog, "stableStrategyTieBreak", "QG-OPT-004", "strategy ranking has no stable final tie-break"],
    [source.catalog, "compareRank", "QG-OPT-004", "strategy ranking is not centralized"],
    [source.aot, "resolveDeploymentTargetProfile", "QG-OPT-006", "AOT does not resolve the deployment profile"],
    [source.extensionLowering, "validateExtensionIR", "QG-OPT-008", "plugin IR bypasses core validation"],
    [source.extensionLowering, "lowerExtensionIR", "QG-OPT-008", "plugin IR bypasses the core compiler lowerer"],
    [source.manifest, "physicalPlanDigest", "QG-OPT-009", "manifest does not bind physical plan identity"],
    [source.aot, "digest: physical.digest", "QG-OPT-009", "manifest physical plans omit their digest"],
  ] as const;
  const findings: QualityFinding[] = [];
  for (const [content, token, code, message] of required) {
    if (!content.includes(token)) findings.push(contractFinding(code, message));
  }
  addDecisionFindings(source, findings);
  return findings;
}

function addDecisionFindings(source: OptimizerSources, findings: QualityFinding[]): void {
  const emitterSource = `${source.arrayEmitter}\n${source.enumEmitter}`;
  if (source.arrayEmitter.includes("arrayUnrollMaxLength") || source.enumEmitter.includes("enumChainMaxCardinality"))
    findings.push(contractFinding("QG-OPT-001", "an emitter contains an unregistered physical threshold"));
  if (!source.catalog.includes("candidate.evidence.every((id) => this.performanceProfile.evidence.includes(id))"))
    findings.push(contractFinding("QG-OPT-003", "optimized candidates do not require promoted evidence"));
  if (
    !source.catalog.includes("stableStrategyTieBreak") ||
    !source.catalog.includes("left.estimate.allocation - right.estimate.allocation")
  )
    findings.push(contractFinding("QG-OPT-004", "strategy tie-breaking omits deterministic dimensions"));
  if (
    !source.physical.includes("optimization.target.digest") ||
    !source.physical.includes("optimization.performance.digest")
  )
    findings.push(contractFinding("QG-OPT-005", "physical digest omits the target or performance profile"));
  if (/\bresolveTargetProfile\s*\(/.test(source.aot))
    findings.push(contractFinding("QG-OPT-006", "AOT reads the build runtime while resolving its target"));
  if (/detectRuntimeFingerprint|process\.versions|navigator\.userAgent/.test(emitterSource))
    findings.push(contractFinding("QG-OPT-007", "runtime detection leaks into validator emission"));
}

function evidenceFindings(source: OptimizerSources): QualityFinding[] {
  const promoted = new Set(source.performanceProfile.match(/"(PERF-[A-Z0-9-]+)"/g)?.map(stripQuotes) ?? []);
  const registered = new Set(source.evidence.match(/id:\s*"(PERF-[A-Z0-9-]+)"/g)?.map(stripId) ?? []);
  for (const evidence of promoted) {
    if (!registered.has(evidence))
      return [contractFinding("QG-OPT-010", `performance profile references unknown evidence ${evidence}`)];
  }
  const assumptions = new Set(source.assumptions.match(/id:\s*"(PERF-[A-Z0-9-]+)"/g)?.map(stripId) ?? []);
  const evidenceAssumptions = source.evidence.match(/assumption:\s*"(PERF-[A-Z0-9-]+)"/g)?.map(stripId) ?? [];
  for (const assumption of evidenceAssumptions) {
    if (!assumptions.has(assumption))
      return [contractFinding("QG-OPT-010", `performance evidence references unknown assumption ${assumption}`)];
  }
  return [];
}

function stripId(value: string): string {
  return value.replace(/^id:\s*"|"$/g, "");
}

function stripQuotes(value: string): string {
  return value.slice(1, -1);
}

function contractFinding(code: string, message: string): QualityFinding {
  return finding({
    code,
    gate: "adaptive",
    severity: "error",
    title: "Contract-first optimizer invariant failed",
    message,
    remediation: "Keep the semantic/physical boundary and add a focused regression before continuing.",
  });
}
