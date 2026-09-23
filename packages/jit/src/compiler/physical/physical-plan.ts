import type * as ATS from "../../core/ats/index.js";
import { resolveHints } from "../../core/hints/index.js";
import type { ExecutionPlan, ValidateStage } from "../execution-plan.js";
import { resolveWrappers } from "../resolvers/resolve-wrappers.js";
import { schemaChildren } from "../schema-recursion.js";
import type { OptimizationDecision } from "../strategy/decision.js";
import { resolveArrayValidationStrategy } from "../strategy/families/array-validation.js";
import { resolveEnumMembershipStrategy } from "../strategy/families/enum-membership.js";
import { resolveTargetProfile } from "../target/resolve-target.js";
import type { TargetDescriptor, TargetProfile } from "../target/target-profile.js";
import { validationMode } from "../validate.js";
import type { PhysicalCapability } from "./physical-capability.js";

/** Semantic execution plus target-specific physical decisions. */
export interface PhysicalPlan {
  readonly execution: ExecutionPlan;
  readonly target: TargetProfile;
  readonly decisions: readonly OptimizationDecision[];
  readonly capabilities: readonly PhysicalCapability[];
  readonly digest: string;
}

/** Resolves physical candidates without changing the semantic execution plan. */
export function resolvePhysicalPlan(plan: ExecutionPlan, target?: TargetDescriptor | TargetProfile): PhysicalPlan {
  const profile = isTargetProfile(target) ? target : resolveTargetProfile(target);
  const decisions: OptimizationDecision[] = [];

  for (const stage of plan.stages) {
    if (stage.kind !== "validate") continue;
    collectValidationDecisions(
      stage.schema,
      profile,
      validationMode(stage.operation),
      decisions,
      new Set<ATS.AnyTypeSchema>()
    );
  }

  const frozenDecisions = Object.freeze(decisions);
  const capabilities = physicalCapabilities(plan);
  return Object.freeze({
    execution: plan,
    target: profile,
    decisions: frozenDecisions,
    capabilities,
    digest: physicalDigest(plan, profile, frozenDecisions, capabilities),
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
  seen: Set<ATS.AnyTypeSchema>
): void {
  const base = resolveWrappers(schema).base;
  if (seen.has(base)) return;
  seen.add(base);

  const array = resolveArrayValidationStrategy(base, profile, operation);
  if (array !== undefined) decisions.push(array);
  const enumeration = resolveEnumMembershipStrategy(base, profile);
  if (enumeration !== undefined) decisions.push(enumeration);

  for (const child of schemaChildren(base)) collectValidationDecisions(child, profile, operation, decisions, seen);
}

function isTargetProfile(value: TargetDescriptor | TargetProfile | undefined): value is TargetProfile {
  return value !== undefined && "weights" in value && "limits" in value;
}

function physicalDigest(
  plan: ExecutionPlan,
  profile: TargetProfile,
  decisions: readonly OptimizationDecision[],
  capabilities: readonly PhysicalCapability[]
): string {
  let hash = 2166136261;
  const source = `${profile.digest}|${plan.stages.map((stage) => stage.kind).join(",")}|${decisions
    .map((decision) => `${decision.family}:${decision.strategy}`)
    .join(",")}|${capabilities.map((capability) => `${capability.kind}:${capability.key ?? ""}`).join(",")}`;
  for (let index = 0; index < source.length; index++) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `physical-${(hash >>> 0).toString(16).padStart(8, "0")}`;
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
