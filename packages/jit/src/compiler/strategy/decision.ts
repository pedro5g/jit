import type { PhysicalOperation, StrategyEstimate } from "./candidate.js";

/** Reviewable record of one physical planner choice. */
export interface OptimizationDecision {
  readonly family: string;
  readonly strategy: string;
  readonly reason: readonly string[];
  readonly evidence: readonly string[];
  readonly estimated: StrategyEstimate;
  readonly operation: PhysicalOperation;
}
