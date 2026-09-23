import { type PerformanceProfile, resolvePerformanceProfile } from "../../performance/profile.js";
import type { TargetProfile } from "../../target/target-profile.js";
import type { StrategyCandidate, StrategyContext } from "../candidate.js";
import { createStrategyCatalog } from "../catalog.js";
import type { OptimizationDecision } from "../decision.js";
import { createStrategyFamily } from "../family.js";

const scan: StrategyCandidate = Object.freeze({
  id: "nested-scan",
  family: "membership.lookup",
  optimized: false,
  portability: "portable",
  evidence: Object.freeze([]),
  legality: () => ({ supported: true, reason: "nested scan preserves the declared equality semantics" }),
  targetSupport: () => ({ supported: true, reason: "indexed loops are supported by every target" }),
  estimate: (context: StrategyContext) => {
    const rows = context.cardinality ?? 0;
    const lookups = context.lookupCount ?? 1;
    return Object.freeze({
      runtime: rows * lookups * 1000,
      allocation: 0,
      setup: 0,
      codeSize: 4_000,
      cold: 0,
      branches: rows * 1000,
    });
  },
  lower: (context: StrategyContext) => Object.freeze({ family: context.family, strategy: "nested-scan" }),
});

const indexOf: StrategyCandidate = Object.freeze({
  id: "indexOf",
  family: "membership.lookup",
  optimized: true,
  portability: "portable",
  evidence: Object.freeze(["PERF-MEMBER-001"]),
  legality: (context: StrategyContext) => {
    const supported = context.equality === "strict" || context.equality === undefined;
    return {
      supported,
      reason: supported
        ? "indexOf uses the requested strict equality"
        : "indexOf does not preserve the requested equality",
    };
  },
  targetSupport: () => ({ supported: true, reason: "Array#indexOf is supported by every target" }),
  estimate: (context: StrategyContext) => {
    const rows = context.cardinality ?? 0;
    const lookups = context.lookupCount ?? 1;
    return Object.freeze({
      runtime: rows * lookups * 800,
      allocation: 0,
      setup: 0,
      codeSize: 2_000,
      cold: 500,
      branches: rows * 1000,
    });
  },
  lower: (context: StrategyContext) => Object.freeze({ family: context.family, strategy: "indexOf" }),
});

const set: StrategyCandidate = Object.freeze({
  id: "set-lookup",
  family: "membership.lookup",
  optimized: true,
  portability: "portable",
  evidence: Object.freeze(["PERF-MEMBER-002"]),
  legality: (context: StrategyContext) => {
    const supported = context.equality === "same-value-zero";
    return {
      supported,
      reason: supported
        ? "Set uses SameValueZero, matching the requested equality"
        : "Set changes the requested equality semantics",
    };
  },
  targetSupport: (context: StrategyContext) => {
    const supported = context.reuse === "repeated" || (context.lookupCount ?? 1) > 2;
    return {
      supported,
      reason: supported
        ? "index setup can be amortized across repeated lookups"
        : "lookup count does not amortize index setup",
    };
  },
  estimate: (context: StrategyContext) => {
    const rows = context.cardinality ?? 0;
    const lookups = context.lookupCount ?? 1;
    return Object.freeze({
      runtime: rows * 250 + lookups * 100,
      allocation: rows,
      setup: rows * 1000,
      codeSize: 7_000,
      cold: 3_000,
      branches: rows * 100,
    });
  },
  lower: (context: StrategyContext) => Object.freeze({ family: context.family, strategy: "set-lookup" }),
});

const indexed: StrategyCandidate = Object.freeze({
  id: "existing-index",
  family: "membership.lookup",
  optimized: true,
  portability: "portable",
  evidence: Object.freeze(["PERF-MEMBER-002"]),
  legality: (context: StrategyContext) => {
    const supported = context.hasIndex === true && context.equality === "same-value-zero";
    return {
      supported,
      reason: supported
        ? "a reusable SameValueZero index is already available"
        : "requires a reusable index with matching equality semantics",
    };
  },
  targetSupport: () => ({ supported: true, reason: "the existing index is target independent" }),
  estimate: (context: StrategyContext) =>
    Object.freeze({
      runtime: (context.lookupCount ?? 1) * 100,
      allocation: 0,
      setup: 0,
      codeSize: 3_000,
      cold: 0,
      branches: 100,
    }),
  lower: (context: StrategyContext) => Object.freeze({ family: context.family, strategy: "existing-index" }),
});

/** Membership family shared by collection predicates and future join lowering. */
export const membershipFamily = createStrategyFamily("membership.lookup", [indexed, scan, indexOf, set]);
/** Resolves a legal membership strategy from equality semantics and reuse facts. */
export function resolveMembershipStrategy(
  context: Omit<StrategyContext, "family" | "facts"> & { readonly facts?: StrategyContext["facts"] },
  profile: TargetProfile,
  performance?: PerformanceProfile
): OptimizationDecision {
  return createStrategyCatalog([membershipFamily], performance ?? resolvePerformanceProfile(profile)).resolve(
    membershipFamily,
    { ...context, family: membershipFamily.id, facts: context.facts ?? [] },
    profile
  );
}
