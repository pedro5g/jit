import type { SemanticFact } from "../facts/schema-facts.js";
import type { TargetProfile } from "../target/target-profile.js";

/** Context supplied to a physical strategy family. */
export interface StrategyContext {
  readonly family: string;
  readonly schema?: unknown;
  readonly facts: readonly SemanticFact[];
  readonly mode?: string;
  readonly cardinality?: number;
  readonly bodyCost?: number;
  readonly lookupCount?: number;
  readonly reuse?: "single" | "repeated";
  readonly equality?: "strict" | "same-value-zero" | "object-is" | "deep";
  readonly ordered?: "asc" | "desc";
  readonly hasIndex?: boolean;
}

/** Separate dimensions retained before target weights collapse a decision. */
export interface StrategyEstimate {
  /** Normalized integer cost units. One unit is one thousandth of a baseline unit. */
  readonly runtime: number;
  readonly allocation: number;
  readonly setup: number;
  readonly codeSize: number;
  readonly cold: number;
  readonly branches: number;
}

/** Explainable result of checking one independent strategy constraint. */
export interface StrategyCheck {
  readonly supported: boolean;
  readonly reason: string;
}

/** Physical operation returned by a candidate; it contains no source text. */
export interface PhysicalOperation {
  readonly family: string;
  readonly strategy: string;
  readonly parameters?: Readonly<Record<string, string | number | boolean>>;
}

/** One semantically legal strategy candidate. */
export interface StrategyCandidate {
  readonly id: string;
  readonly family: string;
  /** False only for an intentionally unoptimized semantic baseline. */
  readonly optimized: boolean;
  readonly portability: "portable" | "target-specific";
  readonly evidence: readonly string[];
  legality(context: StrategyContext): StrategyCheck;
  targetSupport(context: StrategyContext, profile: TargetProfile): StrategyCheck;
  estimate(context: StrategyContext, profile: TargetProfile): StrategyEstimate;
  lower(context: StrategyContext): PhysicalOperation;
}
