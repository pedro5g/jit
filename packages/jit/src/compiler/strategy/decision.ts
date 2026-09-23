import type { PhysicalOperation, StrategyEstimate } from "./candidate.js";

/** Outcome recorded for every candidate considered by a strategy family. */
export interface StrategyEvaluation {
  readonly strategy: string;
  readonly status:
    | "selected"
    | "illegal"
    | "unsupported-target"
    | "insufficient-evidence"
    | "dominated"
    | "higher-cost";
  readonly reason: string;
  readonly estimate?: StrategyEstimate;
}

/** Reviewable record of one physical planner choice. */
export interface OptimizationDecision {
  readonly family: string;
  readonly strategy: string;
  readonly reason: readonly string[];
  readonly evidence: readonly string[];
  readonly estimated: StrategyEstimate;
  readonly operation: PhysicalOperation;
  readonly targetProfile: string;
  readonly performanceProfileVersion: string;
  readonly considered: readonly StrategyEvaluation[];
}
