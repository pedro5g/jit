import type * as ATS from "../../../core/ats/index.js";
import { TypeName } from "../../../core/ats/index.js";
import { normalizeConstraints } from "../../facts/constraint-model.js";
import type { TargetProfile } from "../../target/target-profile.js";
import type { StrategyCandidate, StrategyContext } from "../candidate.js";
import { createStrategyCatalog } from "../catalog.js";
import type { OptimizationDecision } from "../decision.js";
import { createStrategyFamily } from "../family.js";

const loop: StrategyCandidate = Object.freeze({
  id: "indexed-loop",
  evidence: Object.freeze(["PERF-ARRAY-001"]),
  supports: (context: StrategyContext) => context.cardinality !== undefined,
  estimate: (context: StrategyContext) => {
    const count = context.cardinality ?? 0;
    const body = context.bodyCost ?? 1;
    return { runtime: count * body + 3, allocation: 0, setup: 0, codeSize: 4, cold: 1, branches: count + 1 };
  },
  lower: (context: StrategyContext) => Object.freeze({ family: context.family, strategy: "indexed-loop" }),
});

const unrolled: StrategyCandidate = Object.freeze({
  id: "unrolled",
  evidence: Object.freeze(["PERF-ARRAY-001"]),
  supports: (context: StrategyContext, profile: TargetProfile) =>
    context.cardinality !== undefined &&
    context.bodyCost !== undefined &&
    context.cardinality <= profile.limits.arrayUnrollMaxLength &&
    context.bodyCost <= profile.limits.arrayUnrollMaxBodyCost,
  estimate: (context: StrategyContext) => {
    const count = context.cardinality ?? 0;
    const body = context.bodyCost ?? 1;
    return {
      runtime: count * body,
      allocation: 0,
      setup: 0,
      codeSize: Math.max(1, count * body * 0.4),
      cold: count * 0.05,
      branches: count,
    };
  },
  lower: (context: StrategyContext) => Object.freeze({ family: context.family, strategy: "unrolled" }),
});

/** Fixed-cardinality array/tuple validation family. */
export const arrayValidationFamily = createStrategyFamily("array.validate", [loop, unrolled]);

const catalog = createStrategyCatalog([arrayValidationFamily]);

/** Resolves the array validation candidate without emitting source. */
export function resolveArrayValidationStrategy(
  schema: ATS.AnyTypeSchema,
  profile: TargetProfile,
  mode = "is"
): OptimizationDecision | undefined {
  if (schema.type !== TypeName.array && schema.type !== TypeName.tuple) return undefined;
  const model = normalizeConstraints(schema);
  const exact = model.cardinality?.exact;
  if (exact === undefined) return undefined;
  const element = schema.type === TypeName.array ? (schema.def as ATS.ElementDef).element : undefined;
  const bodyCost = element === undefined ? 1 : elementCost(element);
  const context: StrategyContext = {
    family: arrayValidationFamily.id,
    schema,
    facts: [],
    mode,
    cardinality: exact,
    bodyCost,
  };
  return catalog.resolve(arrayValidationFamily, context, profile);
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
