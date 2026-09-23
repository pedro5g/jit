import type { TargetProfile } from "../../target/target-profile.js";
import type { StrategyCandidate, StrategyContext } from "../candidate.js";
import { createStrategyCatalog } from "../catalog.js";
import type { OptimizationDecision } from "../decision.js";
import { createStrategyFamily } from "../family.js";

const scan: StrategyCandidate = Object.freeze({
  id: "nested-scan",
  evidence: Object.freeze(["PERF-MEMBER-001"]),
  supports: () => true,
  estimate: (context: StrategyContext) => {
    const rows = context.cardinality ?? 0;
    const lookups = context.lookupCount ?? 1;
    return Object.freeze({ runtime: rows * lookups, allocation: 0, setup: 0, codeSize: 4, cold: 0, branches: rows });
  },
  lower: (context: StrategyContext) => Object.freeze({ family: context.family, strategy: "nested-scan" }),
});

const indexOf: StrategyCandidate = Object.freeze({
  id: "indexOf",
  evidence: Object.freeze(["PERF-MEMBER-001"]),
  supports: (context: StrategyContext) => context.equality === "strict" || context.equality === undefined,
  estimate: (context: StrategyContext) => {
    const rows = context.cardinality ?? 0;
    const lookups = context.lookupCount ?? 1;
    return Object.freeze({ runtime: rows * lookups * 0.8, allocation: 0, setup: 0, codeSize: 2, cold: 0.5 });
  },
  lower: (context: StrategyContext) => Object.freeze({ family: context.family, strategy: "indexOf" }),
});

const set: StrategyCandidate = Object.freeze({
  id: "set-lookup",
  evidence: Object.freeze(["PERF-MEMBER-002"]),
  supports: (context: StrategyContext) =>
    context.equality === "same-value-zero" && (context.reuse === "repeated" || (context.lookupCount ?? 1) > 2),
  estimate: (context: StrategyContext) => {
    const rows = context.cardinality ?? 0;
    const lookups = context.lookupCount ?? 1;
    return Object.freeze({ runtime: rows + lookups, allocation: 1, setup: rows, codeSize: 7, cold: 3 });
  },
  lower: (context: StrategyContext) => Object.freeze({ family: context.family, strategy: "set-lookup" }),
});

const indexed: StrategyCandidate = Object.freeze({
  id: "existing-index",
  evidence: Object.freeze(["PERF-MEMBER-002"]),
  supports: (context: StrategyContext) => context.hasIndex === true,
  estimate: (context: StrategyContext) =>
    Object.freeze({ runtime: context.lookupCount ?? 1, allocation: 0, setup: 0, codeSize: 3, cold: 0 }),
  lower: (context: StrategyContext) => Object.freeze({ family: context.family, strategy: "existing-index" }),
});

/** Membership family shared by collection predicates and future join lowering. */
export const membershipFamily = createStrategyFamily("membership.lookup", [indexed, scan, indexOf, set]);
const catalog = createStrategyCatalog([membershipFamily]);

/** Resolves a legal membership strategy from equality semantics and reuse facts. */
export function resolveMembershipStrategy(
  context: Omit<StrategyContext, "family" | "facts"> & { readonly facts?: StrategyContext["facts"] },
  profile: TargetProfile
): OptimizationDecision {
  return catalog.resolve(
    membershipFamily,
    { ...context, family: membershipFamily.id, facts: context.facts ?? [] },
    profile
  );
}
