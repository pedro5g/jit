import type * as ATS from "../../../core/ats/index.js";
import { TypeName } from "../../../core/ats/index.js";
import { normalizeConstraints } from "../../facts/constraint-model.js";
import { type PerformanceProfile, resolvePerformanceProfile } from "../../performance/profile.js";
import type { TargetProfile } from "../../target/target-profile.js";
import type { StrategyCandidate, StrategyContext } from "../candidate.js";
import { createStrategyCatalog } from "../catalog.js";
import type { OptimizationDecision } from "../decision.js";
import { createStrategyFamily } from "../family.js";

const directChain: StrategyCandidate = Object.freeze({
  id: "direct-chain",
  family: "enum.membership",
  optimized: false,
  portability: "portable",
  evidence: Object.freeze([]),
  legality: (context: StrategyContext) => {
    const cardinality = context.cardinality ?? 0;
    const supported = cardinality > 0 && hasSupportedEnumValues(context.schema);
    return {
      supported,
      reason: supported
        ? "all enum values use supported primitive comparison"
        : "enum values are not statically available",
    };
  },
  targetSupport: () => ({ supported: true, reason: "direct comparisons are supported by every target" }),
  estimate: (context: StrategyContext) => ({
    runtime: (context.cardinality ?? 0) * 1000,
    allocation: 0,
    setup: 0,
    codeSize: (context.cardinality ?? 0) * 500,
    cold: 2_000,
    branches: (context.cardinality ?? 0) * 1000,
  }),
  lower: (context: StrategyContext) => Object.freeze({ family: context.family, strategy: "direct-chain" }),
});

const switchCandidate: StrategyCandidate = Object.freeze({
  id: "switch",
  family: "enum.membership",
  optimized: true,
  portability: "portable",
  evidence: Object.freeze(["PERF-ENUM-003"]),
  legality: (context: StrategyContext) => {
    const values = enumValues(context.schema);
    const supported = values?.every((value) => typeof value === "number" && !Number.isNaN(value)) === true;
    return {
      supported,
      reason: supported ? "numeric values support switch case equality" : "requires finite numeric enum values",
    };
  },
  targetSupport: (context: StrategyContext, profile: TargetProfile) => {
    const cardinality = context.cardinality ?? 0;
    const supported =
      cardinality > profile.limits.enumChainMaxCardinality && cardinality <= profile.limits.enumSwitchMaxCardinality;
    return {
      supported,
      reason: supported
        ? `cardinality is within ${profile.id} switch limits`
        : `cardinality is outside ${profile.id} switch limits`,
    };
  },
  estimate: (context: StrategyContext) => {
    const cardinality = context.cardinality ?? 0;
    return {
      runtime: 250,
      allocation: 0,
      setup: 0,
      codeSize: cardinality * 250 + 1000,
      cold: 1500,
      branches: cardinality * 100,
    };
  },
  lower: (context: StrategyContext) => Object.freeze({ family: context.family, strategy: "switch" }),
});

const lookup: StrategyCandidate = Object.freeze({
  id: "lookup-object",
  family: "enum.membership",
  optimized: true,
  portability: "portable",
  evidence: Object.freeze(["PERF-ENUM-002"]),
  legality: (context: StrategyContext) => {
    const supported = lookupSafe(context.schema);
    return {
      supported,
      reason: supported
        ? "homogeneous primitive keys can use a null-prototype lookup"
        : "lookup key coercion would change membership semantics",
    };
  },
  targetSupport: () => ({ supported: true, reason: "null-prototype objects are supported by every target" }),
  estimate: (context: StrategyContext) => ({
    runtime: 200,
    allocation: 0,
    setup: 500,
    codeSize: (context.cardinality ?? 0) * 250 + 500,
    cold: 1500,
    branches: 100,
  }),
  lower: (context: StrategyContext) => Object.freeze({ family: context.family, strategy: "lookup-object" }),
});

const enumMembershipFamily = createStrategyFamily("enum.membership", [directChain, switchCandidate, lookup]);
/** Resolves the default enum membership candidate for literal/enum schemas. */
export function resolveEnumMembershipStrategy(
  schema: ATS.AnyTypeSchema,
  profile: TargetProfile,
  performance: PerformanceProfile | undefined = undefined,
  mode = "is"
): OptimizationDecision | undefined {
  if (schema.type !== TypeName.enum) return undefined;
  const model = normalizeConstraints(schema);
  const cardinality = model.enumValues?.length;
  if (cardinality === undefined) return undefined;
  const context: StrategyContext = { family: enumMembershipFamily.id, schema, facts: [], cardinality, mode };
  return createStrategyCatalog([enumMembershipFamily], performance ?? resolvePerformanceProfile(profile)).resolve(
    enumMembershipFamily,
    context,
    profile
  );
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

function hasSupportedEnumValues(schema: unknown): boolean {
  const values = enumValues(schema);
  return values !== undefined && values.length > 0;
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
