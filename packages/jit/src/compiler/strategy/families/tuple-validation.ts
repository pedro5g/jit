import type * as ATS from "../../../core/ats/index.js";
import { TypeName } from "../../../core/ats/index.js";
import { normalizeConstraints } from "../../facts/constraint-model.js";
import { type PerformanceProfile, resolvePerformanceProfile } from "../../performance/profile.js";
import type { TargetProfile } from "../../target/target-profile.js";
import type { StrategyCandidate, StrategyContext } from "../candidate.js";
import { createStrategyCatalog } from "../catalog.js";
import type { OptimizationDecision } from "../decision.js";
import { createStrategyFamily } from "../family.js";

const positional: StrategyCandidate = Object.freeze({
  id: "positional-checks",
  family: "tuple.fixed.validate",
  optimized: false,
  portability: "portable",
  evidence: Object.freeze([]),
  legality: (context: StrategyContext) => ({
    supported: context.cardinality !== undefined,
    reason:
      context.cardinality === undefined ? "requires a fixed tuple shape" : "each tuple position has a known schema",
  }),
  targetSupport: () => ({ supported: true, reason: "static positional checks are supported by every target" }),
  estimate: (context: StrategyContext) => {
    const count = context.cardinality ?? 0;
    const body = context.bodyCost ?? 1;
    return Object.freeze({
      runtime: body * 1000,
      allocation: 0,
      setup: 0,
      codeSize: count * body * 400,
      cold: count * 50,
      branches: count * 1000,
    });
  },
  lower: (context: StrategyContext) => Object.freeze({ family: context.family, strategy: "positional-checks" }),
});

/** Heterogeneous fixed tuples use their schema-known positions, independently of homogeneous arrays. */
export const tupleValidationFamily = createStrategyFamily("tuple.fixed.validate", [positional]);

/** Resolves the portable positional plan for a fixed tuple. */
export function resolveTupleValidationStrategy(
  schema: ATS.AnyTypeSchema,
  profile: TargetProfile,
  mode = "is",
  performance?: PerformanceProfile
): OptimizationDecision | undefined {
  if (schema.type !== TypeName.tuple) return undefined;
  const exact = normalizeConstraints(schema).cardinality?.exact;
  if (exact === undefined) return undefined;
  const items = (schema.def as ATS.TupleDef).items;
  const bodyCost = items.reduce((total, item) => total + schemaCost(item), 0);
  const context: StrategyContext = {
    family: tupleValidationFamily.id,
    schema,
    facts: [],
    mode,
    cardinality: exact,
    bodyCost,
  };
  return createStrategyCatalog([tupleValidationFamily], performance ?? resolvePerformanceProfile(profile)).resolve(
    tupleValidationFamily,
    context,
    profile
  );
}

function schemaCost(schema: ATS.AnyTypeSchema): number {
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
