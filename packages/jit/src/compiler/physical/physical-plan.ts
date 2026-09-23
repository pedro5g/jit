import type * as ATS from "../../core/ats/index.js";
import { TypeName } from "../../core/ats/index.js";
import { environmentForSchema, getActiveEnvironment } from "../../core/environment/environment.js";
import { resolveHints } from "../../core/hints/index.js";
import type { ExtensionSet } from "../../extensions/extension-set.js";
import type { ExecutionPlan, ValidateStage } from "../execution-plan.js";
import { createOptimizationContext, type OptimizationContext } from "../optimization-context.js";
import { type PerformanceProfile, resolvePerformanceProfile } from "../performance/profile.js";
import { resolveWrappers } from "../resolvers/resolve-wrappers.js";
import { schemaChildren } from "../schema-recursion.js";
import { STRATEGY_CATALOG_VERSION } from "../strategy/catalog.js";
import type { OptimizationDecision } from "../strategy/decision.js";
import { resolveArrayValidationStrategy } from "../strategy/families/array-validation.js";
import { resolveEnumMembershipStrategy } from "../strategy/families/enum-membership.js";
import { resolveTupleValidationStrategy } from "../strategy/families/tuple-validation.js";
import { resolveTargetProfile } from "../target/resolve-target.js";
import { assertTargetProfile, type TargetDescriptor, type TargetProfile } from "../target/target-profile.js";
import { validationMode } from "../validate.js";
import type { PhysicalCapability } from "./physical-capability.js";

/** Semantic execution plus target-specific physical decisions. */
export interface PhysicalPlan {
  readonly execution: ExecutionPlan;
  readonly target: TargetProfile;
  readonly optimization: OptimizationContext;
  readonly strategyCatalogVersion: string;
  readonly performanceProfileVersion: string;
  readonly decisions: readonly OptimizationDecision[];
  readonly capabilities: readonly PhysicalCapability[];
  readonly digest: string;
}

/** Resolves physical candidates without changing the semantic execution plan. */
export function resolvePhysicalPlan(
  plan: ExecutionPlan,
  target?: TargetDescriptor | TargetProfile,
  options: { readonly extensions?: ExtensionSet; readonly performance?: PerformanceProfile } = {}
): PhysicalPlan {
  const profile = isTargetProfile(target) ? assertTargetProfile(target) : resolveTargetProfile(target);
  const environment = environmentForSchema(plan.schema) ?? getActiveEnvironment();
  const capabilities = physicalCapabilities(plan);
  const optimization = createOptimizationContext(
    plan,
    profile,
    capabilities,
    options.extensions ?? environment.extensions,
    options.performance ?? resolvePerformanceProfile(profile)
  );
  const decisions: OptimizationDecision[] = [];

  for (const stage of plan.stages) {
    if (stage.kind !== "validate") continue;
    collectValidationDecisions(
      stage.schema,
      profile,
      validationMode(stage.operation),
      decisions,
      new Set<ATS.AnyTypeSchema>(),
      optimization.performance
    );
  }

  const frozenDecisions = Object.freeze(decisions);
  return Object.freeze({
    execution: plan,
    target: profile,
    optimization,
    strategyCatalogVersion: STRATEGY_CATALOG_VERSION,
    performanceProfileVersion: `${optimization.performance.id}@${optimization.performance.version}`,
    decisions: frozenDecisions,
    capabilities,
    digest: physicalDigest(plan, optimization, frozenDecisions, capabilities),
  });
}

/** Builds the same physical plan used by AOT for a standalone validator artifact. */
export function resolveValidationPhysicalPlan(
  schema: ATS.AnyTypeSchema,
  operation: ValidateStage["operation"],
  target?: TargetDescriptor | TargetProfile
): PhysicalPlan {
  const stage = {
    kind: "validate" as const,
    input: "value" as const,
    output: operation === "is" ? ("boolean" as const) : ("value" as const),
    schema,
    operation,
    requires: Object.freeze([]),
    provides: Object.freeze([]),
    effects: Object.freeze({
      mayThrow: operation === "parse" || operation === "parseAsync",
      mayAllocate: operation !== "is",
      usesExternalBindings: false,
    }),
  } satisfies ValidateStage;
  return resolvePhysicalPlan(Object.freeze({ version: 1 as const, schema, stages: Object.freeze([stage]) }), target);
}

function collectValidationDecisions(
  schema: ATS.AnyTypeSchema,
  profile: TargetProfile,
  operation: string,
  decisions: OptimizationDecision[],
  seen: Set<ATS.AnyTypeSchema>,
  performance: PerformanceProfile
): void {
  const base = resolveWrappers(schema).base;
  if (seen.has(base)) return;
  seen.add(base);

  const collection =
    base.type === TypeName.tuple
      ? resolveTupleValidationStrategy(base, profile, operation, performance)
      : resolveArrayValidationStrategy(base, profile, operation, performance);
  if (collection !== undefined) decisions.push(collection);
  const enumeration = resolveEnumMembershipStrategy(base, profile, performance, operation);
  if (enumeration !== undefined) decisions.push(enumeration);

  for (const child of schemaChildren(base))
    collectValidationDecisions(child, profile, operation, decisions, seen, performance);
}

function isTargetProfile(value: TargetDescriptor | TargetProfile | undefined): value is TargetProfile {
  return value !== undefined && "weights" in value && "limits" in value;
}

function physicalDigest(
  plan: ExecutionPlan,
  optimization: OptimizationContext,
  decisions: readonly OptimizationDecision[],
  capabilities: readonly PhysicalCapability[]
): string {
  const source = stableString({
    contract: executionContract(plan),
    semanticFacts: optimization.semanticFacts,
    optimizationFacts: optimization.optimizationFacts,
    target: { id: optimization.target.id, digest: optimization.target.digest },
    strategyCatalogVersion: STRATEGY_CATALOG_VERSION,
    performanceProfile: {
      id: optimization.performance.id,
      version: optimization.performance.version,
      digest: optimization.performance.digest,
    },
    extensions: optimization.extensions.digest,
    semanticExtensions: optimization.semanticExtensions,
    decisions,
    capabilities,
  });
  let first = 2166136261;
  let second = 2246822519;
  for (let index = 0; index < source.length; index++) {
    const code = source.charCodeAt(index);
    first = Math.imul(first ^ code, 16777619);
    second = Math.imul(second ^ (code + index), 3266489917);
  }
  return `physical-${(first >>> 0).toString(16).padStart(8, "0")}${(second >>> 0).toString(16).padStart(8, "0")}`;
}

function executionContract(plan: ExecutionPlan): unknown {
  return {
    version: plan.version,
    schema: stableValue(plan.schema, new Map<object, number>()),
    stages: plan.stages.map((stage) => stableValue(stage, new Map<object, number>())),
  };
}

function stableString(value: unknown): string {
  return JSON.stringify(value);
}

function stableValue(value: unknown, seen: Map<object, number>, preserveEntryOrder = false): unknown {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") return stableNumber(value);
  if (typeof value === "bigint") return `${value}n`;
  if (typeof value === "undefined") return "$undefined";
  if (typeof value === "function") return `$external:${value.name || "anonymous"}`;
  if (typeof value !== "object") return String(value);
  const previous = seen.get(value);
  if (previous !== undefined) return { $ref: previous };
  seen.set(value, seen.size);
  if (value instanceof RegExp) return { $regexp: value.source, flags: value.flags };
  if (Array.isArray(value)) return stableArray(value, seen);
  if (isSchemaValue(value)) return stableSchema(value, seen);
  return stableRecord(value as Record<string, unknown>, seen, preserveEntryOrder);
}

function stableNumber(value: number): number | string {
  if (Number.isNaN(value)) return "$NaN";
  return Object.is(value, -0) ? "$-0" : value;
}

function stableArray(value: readonly unknown[], seen: Map<object, number>): readonly unknown[] {
  return value.map((entry) => stableValue(entry, seen));
}

function stableSchema(
  value: { readonly type: unknown; readonly def: unknown; readonly annotations?: unknown },
  seen: Map<object, number>
): unknown {
  const extensionIdentities = isRecord(value.annotations) ? value.annotations.extensions : undefined;
  const annotations =
    Array.isArray(extensionIdentities) && extensionIdentities.length > 0
      ? { extensions: stableValue(extensionIdentities, seen) }
      : {};
  return { $schema: true, type: String(value.type), def: stableValue(value.def, seen), annotations };
}

function stableRecord(
  record: Record<string, unknown>,
  seen: Map<object, number>,
  preserveEntryOrder: boolean
): Readonly<Record<string, unknown>> {
  const keys = Object.keys(record).filter((key) => !ignoredDigestKey(key));
  keys.sort((left, right) => compareDigestKey(left, right, preserveEntryOrder));
  return Object.fromEntries(keys.map((key) => [key, stableValue(record[key], seen, key === "props")]));
}

function ignoredDigestKey(key: string): boolean {
  return key === "metadata" || key === "meta" || key === "annotations";
}

function compareDigestKey(left: string, right: string, preserveEntryOrder: boolean): number {
  if (left === right) return 0;
  if (preserveEntryOrder) return 0;
  if (left === "props") return -1;
  if (right === "props") return 1;
  return compareText(left, right);
}

function isSchemaValue(
  value: object
): value is { readonly type: unknown; readonly def: unknown; readonly annotations?: unknown } {
  return "type" in value && "def" in value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function physicalCapabilities(plan: ExecutionPlan): readonly PhysicalCapability[] {
  const capabilities: PhysicalCapability[] = [];
  const seen = new Set<string>();
  plan.stages.forEach((stage, sourceStage) => {
    const schema = stageSchema(stage);
    if (schema === undefined) return;
    const hints = resolveHints(schema);
    const indexKey = hints.index?.key ?? hints.collection?.identify ?? hints.entity?.key;
    if (typeof indexKey === "string")
      addCapability(capabilities, seen, { kind: "index", key: indexKey, sourceStage, reusable: true });
    const order = hints.order ?? hints.collection?.ordered;
    if (typeof order?.key === "string")
      addCapability(capabilities, seen, { kind: "ordering", key: order.key, sourceStage, reusable: true });
    if (hints.hash?.strategy !== undefined)
      addCapability(capabilities, seen, { kind: "hash", key: hints.hash.strategy, sourceStage, reusable: true });
  });
  return Object.freeze(capabilities);
}

function stageSchema(stage: ExecutionPlan["stages"][number]): ATS.AnyTypeSchema | undefined {
  if (stage.schema !== undefined) return stage.schema;
  if (stage.kind === "map" || stage.kind === "transform") return stage.source;
  if (stage.kind === "query" || stage.kind === "aggregate") return stage.source;
  return undefined;
}

function addCapability(capabilities: PhysicalCapability[], seen: Set<string>, capability: PhysicalCapability): void {
  const key = `${capability.kind}:${capability.key ?? ""}`;
  if (seen.has(key)) return;
  seen.add(key);
  capabilities.push(Object.freeze(capability));
}

/** Returns the selected decision for one schema and family. */
export function decisionFor(
  physical: PhysicalPlan,
  family: string,
  _schema?: ATS.AnyTypeSchema
): OptimizationDecision | undefined {
  return physical.decisions.find((decision) => decision.family === family);
}
