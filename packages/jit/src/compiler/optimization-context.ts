import type { ExtensionSet } from "../extensions/extension-set.js";
import { createExtensionSet } from "../extensions/extension-set.js";
import type { ExecutionPlan } from "./execution-plan.js";
import { resolveSemanticExtensionPlans } from "./extension-lowering.js";
import { deriveSchemaFacts, type SemanticFact } from "./facts/schema-facts.js";
import { defaultPerformanceProfile, type PerformanceProfile } from "./performance/profile.js";
import type { PhysicalCapability } from "./physical/physical-capability.js";
import type { TargetProfile } from "./target/target-profile.js";

/** Facts proven by stages already present in the immutable execution plan. */
export interface OptimizationFacts {
  readonly previousStageProvides: readonly string[];
  readonly existingIndexes: readonly string[];
  readonly indexReuseCount: Readonly<Record<string, number>>;
  readonly lookupCount: number;
  readonly inputAlreadyValidated: boolean;
  readonly capabilities: readonly PhysicalCapability[];
}

/** All immutable inputs that may influence one physical decision. */
export interface OptimizationContext {
  readonly target: TargetProfile;
  readonly semanticFacts: readonly SemanticFact[];
  readonly optimizationFacts: OptimizationFacts;
  readonly extensions: ExtensionSet;
  readonly performance: PerformanceProfile;
  readonly semanticExtensions: readonly {
    readonly id: string;
    readonly version: string;
    readonly irDigest: string;
  }[];
}

/** Builds the complete optimization context before strategy evaluation. */
export function createOptimizationContext(
  plan: ExecutionPlan,
  target: TargetProfile,
  capabilities: readonly PhysicalCapability[],
  extensions: ExtensionSet = createExtensionSet(),
  performance: PerformanceProfile = defaultPerformanceProfile
): OptimizationContext {
  const facts = normalizeSemanticFacts(deriveSchemaFacts(plan.schema));
  const existingIndexes = capabilities
    .filter((capability) => capability.kind === "index" && capability.key !== undefined)
    .map((capability) => capability.key as string)
    .sort(compareText);
  const indexReuseCount: Record<string, number> = {};
  for (const key of existingIndexes) indexReuseCount[key] = (indexReuseCount[key] ?? 0) + 1;
  const previousStageProvides = plan.stages.flatMap((stage) => stage.provides).sort(compareText);
  const optimizationFacts: OptimizationFacts = Object.freeze({
    previousStageProvides: Object.freeze(previousStageProvides),
    existingIndexes: Object.freeze(existingIndexes),
    indexReuseCount: Object.freeze(indexReuseCount),
    lookupCount: plan.stages.filter((stage) => stage.kind === "query" || stage.kind === "aggregate").length,
    inputAlreadyValidated: plan.stages.some((stage) => stage.kind === "validate"),
    capabilities: Object.freeze([...capabilities]),
  });
  const semanticExtensions = Object.freeze(
    resolveSemanticExtensionPlans(plan.schema, extensions, facts).map(({ id, version, irDigest }) =>
      Object.freeze({ id, version, irDigest })
    )
  );
  return Object.freeze({
    target,
    semanticFacts: facts,
    optimizationFacts,
    extensions,
    performance: Object.freeze({ ...performance, evidence: Object.freeze([...performance.evidence]) }),
    semanticExtensions,
  });
}

function normalizeSemanticFacts(facts: readonly SemanticFact[]): readonly SemanticFact[] {
  return Object.freeze(
    [...facts].sort(
      (left, right) =>
        compareText(left.path.join("\u0000"), right.path.join("\u0000")) ||
        compareText(left.kind, right.kind) ||
        compareText(stableValue(left), stableValue(right))
    )
  );
}

function stableValue(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "undefined";
  if (Array.isArray(value)) return `[${value.map(stableValue).join(",")}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => compareText(left, right))
    .map(([key, entry]) => `${JSON.stringify(key)}:${stableValue(entry)}`)
    .join(",")}}`;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
