import type * as ATS from "../../../core/ats/index.js";
import { TypeName } from "../../../core/ats/index.js";
import { normalizeConstraints } from "../../facts/constraint-model.js";
import type { TargetProfile } from "../../target/target-profile.js";
import type { StrategyCandidate, StrategyContext } from "../candidate.js";
import { createStrategyCatalog } from "../catalog.js";
import type { OptimizationDecision } from "../decision.js";
import { createStrategyFamily } from "../family.js";

const directChain: StrategyCandidate = Object.freeze({
  id: "direct-chain",
  evidence: Object.freeze(["PERF-ENUM-001"]),
  supports: (context: StrategyContext, profile: TargetProfile) => {
    const cardinality = context.cardinality ?? 0;
    return cardinality > 0 && (cardinality <= profile.limits.enumChainMaxCardinality || !lookupSafe(context.schema));
  },
  estimate: (context: StrategyContext) => ({
    runtime: context.cardinality ?? 0,
    allocation: 0,
    setup: 0,
    codeSize: context.cardinality ?? 0,
    cold: 1,
  }),
  lower: (context: StrategyContext) => Object.freeze({ family: context.family, strategy: "direct-chain" }),
});

const switchCandidate: StrategyCandidate = Object.freeze({
  id: "switch",
  evidence: Object.freeze(["PERF-ENUM-003"]),
  supports: (context: StrategyContext, profile: TargetProfile) => {
    const values = enumValues(context.schema);
    const cardinality = values?.length ?? 0;
    return (
      cardinality > profile.limits.enumChainMaxCardinality &&
      cardinality <= profile.limits.enumSwitchMaxCardinality &&
      values?.every((value) => typeof value === "number" && !Number.isNaN(value)) === true
    );
  },
  estimate: (context: StrategyContext) => {
    const cardinality = context.cardinality ?? 0;
    return {
      runtime: 0.8,
      allocation: 0,
      setup: 0,
      codeSize: cardinality * 0.8 + 1,
      cold: 1,
    };
  },
  lower: (context: StrategyContext) => Object.freeze({ family: context.family, strategy: "switch" }),
});

const lookup: StrategyCandidate = Object.freeze({
  id: "lookup-object",
  evidence: Object.freeze(["PERF-ENUM-002"]),
  supports: (context: StrategyContext) => (context.cardinality ?? 0) > 4 && lookupSafe(context.schema),
  estimate: (context: StrategyContext) => ({
    runtime: 1,
    allocation: 0,
    setup: 2,
    codeSize: (context.cardinality ?? 0) + 2,
    cold: 2,
  }),
  lower: (context: StrategyContext) => Object.freeze({ family: context.family, strategy: "lookup-object" }),
});

const enumMembershipFamily = createStrategyFamily("enum.membership", [directChain, switchCandidate, lookup]);
const catalog = createStrategyCatalog([enumMembershipFamily]);

/** Resolves the default enum membership candidate for literal/enum schemas. */
export function resolveEnumMembershipStrategy(
  schema: ATS.AnyTypeSchema,
  profile: TargetProfile
): OptimizationDecision | undefined {
  if (schema.type !== TypeName.enum && schema.type !== TypeName.literal) return undefined;
  const model = normalizeConstraints(schema);
  const cardinality = schema.type === TypeName.literal ? 1 : model.enumValues?.length;
  if (cardinality === undefined) return undefined;
  const context: StrategyContext = { family: enumMembershipFamily.id, schema, facts: [], cardinality };
  return catalog.resolve(enumMembershipFamily, context, profile);
}

function lookupSafe(schema: unknown): boolean {
  if (typeof schema !== "object" || schema === null || !("def" in schema)) return false;
  const def = (schema as { readonly def?: { readonly values?: unknown } }).def;
  const values = def?.values;
  if (typeof values !== "object" || values === null) return false;
  const entries = Object.values(values).filter(
    (value): value is string | number => typeof value === "string" || typeof value === "number"
  );
  if (entries.length === 0 || entries.some((value) => typeof value === "number" && Number.isNaN(value))) return false;
  const type = typeof entries[0];
  return entries.every((value) => typeof value === type);
}

function enumValues(schema: unknown): readonly (string | number)[] | undefined {
  if (typeof schema !== "object" || schema === null || !("def" in schema)) return undefined;
  const values = (schema as { readonly def?: { readonly values?: unknown } }).def?.values;
  if (Array.isArray(values))
    return values.filter((value): value is string | number => typeof value === "string" || typeof value === "number");
  if (typeof values !== "object" || values === null) return undefined;
  return Object.values(values).filter(
    (value): value is string | number => typeof value === "string" || typeof value === "number"
  );
}
