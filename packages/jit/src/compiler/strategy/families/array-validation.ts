import type * as ATS from "../../../core/ats/index.js";
import { TypeName } from "../../../core/ats/index.js";
import { normalizeConstraints } from "../../facts/constraint-model.js";
import { type PerformanceProfile, resolvePerformanceProfile } from "../../performance/profile.js";
import type { TargetProfile } from "../../target/target-profile.js";
import type { StrategyCandidate, StrategyContext } from "../candidate.js";
import { createStrategyCatalog } from "../catalog.js";
import type { OptimizationDecision } from "../decision.js";
import { createStrategyFamily } from "../family.js";

const loop: StrategyCandidate = Object.freeze({
  id: "indexed-loop",
  family: "array.validate",
  optimized: false,
  portability: "portable",
  evidence: Object.freeze([]),
  legality: (context: StrategyContext) => ({
    supported: context.cardinality !== undefined,
    reason: context.cardinality === undefined ? "requires proven fixed cardinality" : "fixed cardinality is proven",
  }),
  targetSupport: () => ({ supported: true, reason: "indexed loops are supported by every target" }),
  estimate: (context: StrategyContext) => {
    const count = context.cardinality ?? 0;
    const body = context.bodyCost ?? 1;
    return {
      runtime: (count * body + 3) * 1000,
      allocation: 0,
      setup: 0,
      codeSize: 4_000,
      cold: 1_000,
      branches: (count + 1) * 1000,
    };
  },
  lower: (context: StrategyContext) => Object.freeze({ family: context.family, strategy: "indexed-loop" }),
});

const unrolled: StrategyCandidate = Object.freeze({
  id: "unrolled",
  family: "array.validate",
  optimized: true,
  portability: "portable",
  evidence: Object.freeze(["PERF-ARRAY-001"]),
  legality: (context: StrategyContext) => {
    const supported =
      context.cardinality !== undefined &&
      context.bodyCost !== undefined &&
      (context.mode === "predicate" || context.mode === "is");
    return {
      supported,
      reason: supported
        ? "fixed cardinality, element cost, and fail-fast predicate mode are proven"
        : "requires fixed cardinality, element cost, and fail-fast predicate mode",
    };
  },
  targetSupport: (context: StrategyContext, profile: TargetProfile) => {
    const supported =
      context.cardinality !== undefined &&
      context.bodyCost !== undefined &&
      context.cardinality <= profile.limits.arrayUnrollMaxLength &&
      context.bodyCost <= profile.limits.arrayUnrollMaxBodyCost;
    return {
      supported,
      reason: supported ? `within ${profile.id} unroll limits` : `exceeds ${profile.id} unroll limits`,
    };
  },
  estimate: (context: StrategyContext) => {
    const count = context.cardinality ?? 0;
    const body = context.bodyCost ?? 1;
    return {
      runtime: count * body * 1000,
      allocation: 0,
      setup: 0,
      codeSize: Math.max(1, count * body * 400),
      cold: count * 50,
      branches: count * 1000,
    };
  },
  lower: (context: StrategyContext) => Object.freeze({ family: context.family, strategy: "unrolled" }),
});

/** Fixed-cardinality array/tuple validation family. */
export const arrayValidationFamily = createStrategyFamily("array.validate", [loop, unrolled]);

/** Resolves the array validation candidate without emitting source. */
export function resolveArrayValidationStrategy(
  schema: ATS.AnyTypeSchema,
  profile: TargetProfile,
  mode = "is",
  performance?: PerformanceProfile
): OptimizationDecision | undefined {
  if (schema.type !== TypeName.array) return undefined;
  const model = normalizeConstraints(schema);
  const exact = model.cardinality?.exact;
  if (exact === undefined) return undefined;
  const element = (schema.def as ATS.ElementDef).element;
  const bodyCost = elementCost(element);
  const context: StrategyContext = {
    family: arrayValidationFamily.id,
    schema,
    facts: [],
    mode,
    cardinality: exact,
    bodyCost,
    equality: "strict",
  };
  return createStrategyCatalog([arrayValidationFamily], performance ?? resolvePerformanceProfile(profile)).resolve(
    arrayValidationFamily,
    context,
    profile
  );
}

function elementCost(schema: ATS.AnyTypeSchema): number {
  switch (schema.type) {
    case TypeName.string:
    case TypeName.number:
    case TypeName.int:
    case TypeName.boolean:
    case TypeName.literal:
    case TypeName.enum:
      return 1;
    case TypeName.object:
      return 4;
    default:
      return 6;
  }
}
