import type { TargetProfile } from "../target/target-profile.js";
import type { StrategyCandidate, StrategyContext } from "./candidate.js";
import type { OptimizationDecision } from "./decision.js";
import type { StrategyFamily } from "./family.js";

/** Immutable catalog of physical strategy families. */
export interface StrategyCatalog {
  readonly families: readonly StrategyFamily[];
  family(id: string): StrategyFamily | undefined;
  add(family: StrategyFamily): StrategyCatalog;
  resolve(family: StrategyFamily, context: StrategyContext, profile: TargetProfile): OptimizationDecision;
}

class Catalog implements StrategyCatalog {
  readonly families: readonly StrategyFamily[];

  constructor(families: readonly StrategyFamily[]) {
    this.families = Object.freeze([...families]);
    Object.freeze(this);
  }

  family(id: string): StrategyFamily | undefined {
    return this.families.find((candidate) => candidate.id === id);
  }

  add(family: StrategyFamily): StrategyCatalog {
    return new Catalog([...this.families.filter((candidate) => candidate.id !== family.id), family]);
  }

  resolve(family: StrategyFamily, context: StrategyContext, profile: TargetProfile): OptimizationDecision {
    const supported = family.candidates.filter((candidate) => candidate.supports(context, profile));
    if (supported.length === 0) throw new Error(`No legal strategy candidate for ${family.id}`);
    const ranked = supported
      .map((candidate) => ({ candidate, estimate: candidate.estimate(context, profile) }))
      .sort(
        (left, right) =>
          score(left.estimate, profile) - score(right.estimate, profile) || compare(left.candidate, right.candidate)
      );
    const selected = ranked[0];
    if (selected === undefined) throw new Error(`No legal strategy candidate for ${family.id}`);
    const operation = selected.candidate.lower(context);
    return Object.freeze({
      family: family.id,
      strategy: selected.candidate.id,
      reason: Object.freeze(reason(context, selected.candidate)),
      evidence: Object.freeze([...selected.candidate.evidence]),
      estimated: Object.freeze(selected.estimate),
      operation,
    });
  }
}

/** Creates a catalog from built-in or plugin-provided families. */
export function createStrategyCatalog(families: readonly StrategyFamily[] = []): StrategyCatalog {
  return new Catalog(families);
}

function score(estimate: ReturnType<StrategyCandidate["estimate"]>, profile: TargetProfile): number {
  return (
    estimate.runtime * profile.weights.runtime +
    estimate.allocation * profile.weights.allocation +
    estimate.setup * profile.weights.setup +
    estimate.codeSize * profile.weights.codeSize +
    (estimate.cold ?? 0) * profile.weights.cold +
    (estimate.branches ?? 0) * (profile.weights.branches ?? 0)
  );
}

function compare(left: StrategyCandidate, right: StrategyCandidate): number {
  return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
}

function reason(context: StrategyContext, candidate: StrategyCandidate): readonly string[] {
  return [
    ...(context.cardinality === undefined ? [] : [`exact cardinality ${context.cardinality} is proven`]),
    ...(context.bodyCost === undefined ? [] : [`estimated body cost ${context.bodyCost}`]),
    `candidate ${candidate.id} is semantically legal`,
  ];
}
