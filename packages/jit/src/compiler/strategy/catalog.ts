import {
  defaultPerformanceProfile,
  isPerformanceProfileDigestValid,
  type PerformanceProfile,
} from "../performance/profile.js";
import { assertTargetProfile, type TargetProfile } from "../target/target-profile.js";
import type { StrategyCandidate, StrategyContext, StrategyEstimate } from "./candidate.js";
import type { OptimizationDecision, StrategyEvaluation } from "./decision.js";
import type { StrategyFamily } from "./family.js";

export {
  createPerformanceProfile,
  defaultPerformanceProfile,
  type PerformanceProfile,
} from "../performance/profile.js";

export const STRATEGY_CATALOG_VERSION = "strategy-catalog-v1";

/** Immutable catalog of physical strategy families. */
export interface StrategyCatalog {
  readonly version: string;
  readonly families: readonly StrategyFamily[];
  family(id: string): StrategyFamily | undefined;
  add(family: StrategyFamily): StrategyCatalog;
  resolve(family: StrategyFamily, context: StrategyContext, profile: TargetProfile): OptimizationDecision;
}

class Catalog implements StrategyCatalog {
  readonly families: readonly StrategyFamily[];
  readonly version: string;
  readonly performanceProfile: PerformanceProfile;

  constructor(families: readonly StrategyFamily[], performanceProfile: PerformanceProfile = defaultPerformanceProfile) {
    const sorted = [...families].sort((left, right) => compareText(left.id, right.id));
    const ids = new Set<string>();
    for (const family of sorted) {
      if (ids.has(family.id)) throw new TypeError(`duplicate strategy family ${family.id}`);
      ids.add(family.id);
    }
    this.families = Object.freeze(sorted);
    this.performanceProfile = validatePerformanceProfile(performanceProfile);
    this.version = STRATEGY_CATALOG_VERSION;
    Object.freeze(this);
  }

  family(id: string): StrategyFamily | undefined {
    return this.families.find((candidate) => candidate.id === id);
  }

  add(family: StrategyFamily): StrategyCatalog {
    const existing = this.family(family.id);
    if (existing !== undefined && familySignature(existing) !== familySignature(family))
      throw new Error(`strategy family ${family.id} is already registered with different candidates`);
    if (existing !== undefined) return this;
    return new Catalog([...this.families, family], this.performanceProfile);
  }

  resolve(family: StrategyFamily, context: StrategyContext, profile: TargetProfile): OptimizationDecision {
    assertTargetProfile(profile);
    if (context.family !== family.id) throw new Error(`strategy context family mismatch for ${family.id}`);
    const checks = family.candidates.map((candidate) => ({
      candidate,
      legality: candidate.legality(context),
      target: candidate.targetSupport(context, profile),
    }));
    const eligible = checks.filter(
      ({ candidate, legality, target }) =>
        legality.supported &&
        target.supported &&
        (!candidate.optimized || candidate.evidence.every((id) => this.performanceProfile.evidence.includes(id)))
    );
    const ranked = eligible
      .map(({ candidate }) => ({ candidate, estimate: validateEstimate(candidate.estimate(context, profile)) }))
      .sort((left, right) => compareRank(left, right, profile));
    const selected = ranked[0];
    if (selected === undefined)
      throw new Error(`No legal, supported, evidence-backed strategy candidate for ${family.id}`);
    const operation = selected.candidate.lower(context);
    const considered = buildEvaluations(family, checks, ranked, selected, this.performanceProfile, profile);
    return Object.freeze({
      family: family.id,
      strategy: selected.candidate.id,
      reason: Object.freeze([
        `semantic legality: ${checks.find((entry) => entry.candidate === selected.candidate)?.legality.reason ?? "supported"}`,
        `target support: ${checks.find((entry) => entry.candidate === selected.candidate)?.target.reason ?? "supported"}`,
        `integer cost score ${score(selected.estimate, profile)}`,
      ]),
      evidence: Object.freeze([...selected.candidate.evidence]),
      estimated: Object.freeze(selected.estimate),
      operation,
      targetProfile: profile.id,
      performanceProfileVersion: `${this.performanceProfile.id}@${this.performanceProfile.version}`,
      considered,
    });
  }
}

/** Creates a catalog from built-in or plugin-provided families. */
export function createStrategyCatalog(
  families: readonly StrategyFamily[] = [],
  performanceProfile: PerformanceProfile = defaultPerformanceProfile
): StrategyCatalog {
  return new Catalog(families, performanceProfile);
}

function score(estimate: StrategyEstimate, profile: TargetProfile): number {
  return (
    estimate.runtime * profile.weights.runtime +
    estimate.allocation * profile.weights.allocation +
    estimate.setup * profile.weights.setup +
    estimate.codeSize * profile.weights.codeSize +
    (estimate.cold ?? 0) * profile.weights.cold +
    (estimate.branches ?? 0) * (profile.weights.branches ?? 0)
  );
}

function compareRank(
  left: { readonly candidate: StrategyCandidate; readonly estimate: StrategyEstimate },
  right: { readonly candidate: StrategyCandidate; readonly estimate: StrategyEstimate },
  profile: TargetProfile
): number {
  return (
    score(left.estimate, profile) - score(right.estimate, profile) ||
    left.estimate.allocation - right.estimate.allocation ||
    left.estimate.cold - right.estimate.cold ||
    left.estimate.codeSize - right.estimate.codeSize ||
    Number(left.candidate.portability === "target-specific") -
      Number(right.candidate.portability === "target-specific") ||
    stableStrategyTieBreak(left.candidate, right.candidate)
  );
}

function stableStrategyTieBreak(left: StrategyCandidate, right: StrategyCandidate): number {
  return compareText(`${left.family}.${left.id}`, `${right.family}.${right.id}`);
}

function buildEvaluations(
  family: StrategyFamily,
  checks: readonly {
    readonly candidate: StrategyCandidate;
    readonly legality: { readonly supported: boolean; readonly reason: string };
    readonly target: { readonly supported: boolean; readonly reason: string };
  }[],
  ranked: readonly { readonly candidate: StrategyCandidate; readonly estimate: StrategyEstimate }[],
  selected: { readonly candidate: StrategyCandidate; readonly estimate: StrategyEstimate },
  performance: PerformanceProfile,
  target: TargetProfile
): readonly StrategyEvaluation[] {
  const byId = new Map(ranked.map((entry) => [entry.candidate.id, entry]));
  return Object.freeze(
    family.candidates.map((candidate) => {
      const check = checks.find((entry) => entry.candidate === candidate);
      if (check === undefined) throw new Error(`missing candidate evaluation for ${family.id}.${candidate.id}`);
      if (!check.legality.supported) return evaluation(candidate.id, "illegal", check.legality.reason);
      if (!check.target.supported) return evaluation(candidate.id, "unsupported-target", check.target.reason);
      if (candidate.optimized && !candidate.evidence.every((id) => performance.evidence.includes(id)))
        return evaluation(
          candidate.id,
          "insufficient-evidence",
          "no evidence reference is promoted by the performance profile"
        );
      const entry = byId.get(candidate.id);
      if (entry === undefined) throw new Error(`missing ranked candidate ${family.id}.${candidate.id}`);
      if (candidate.id === selected.candidate.id)
        return evaluation(candidate.id, "selected", `lowest deterministic cost for ${target.id}`, entry.estimate);
      const selectedScore = score(selected.estimate, target);
      const candidateScore = score(entry.estimate, target);
      const isDominated = dominates(selected.estimate, entry.estimate);
      return evaluation(
        candidate.id,
        isDominated ? "dominated" : "higher-cost",
        isDominated
          ? `selected ${selected.candidate.id} is no worse in every estimated dimension`
          : `estimated score ${candidateScore} is not lower than selected score ${selectedScore}`,
        entry.estimate
      );
    })
  );
}

function evaluation(
  strategy: string,
  status: StrategyEvaluation["status"],
  reason: string,
  estimate?: StrategyEstimate
): StrategyEvaluation {
  return Object.freeze({ strategy, status, reason, ...(estimate === undefined ? {} : { estimate }) });
}

function dominates(left: StrategyEstimate, right: StrategyEstimate): boolean {
  const dimensions = ["runtime", "allocation", "setup", "codeSize", "cold", "branches"] as const;
  let strictlyBetter = false;
  for (const dimension of dimensions) {
    if (left[dimension] > right[dimension]) return false;
    if (left[dimension] < right[dimension]) strictlyBetter = true;
  }
  return strictlyBetter;
}

function validateEstimate(estimate: StrategyEstimate): StrategyEstimate {
  for (const key of ["runtime", "allocation", "setup", "codeSize", "cold", "branches"] as const) {
    if (!Number.isSafeInteger(estimate[key]) || estimate[key] < 0)
      throw new TypeError(`strategy estimate ${key} must be a non-negative safe integer`);
  }
  return Object.freeze({ ...estimate });
}

function validatePerformanceProfile(profile: PerformanceProfile): PerformanceProfile {
  if (profile.id.length === 0 || profile.version.length === 0 || profile.digest.length === 0)
    throw new TypeError("performance profiles require an id, version, and digest");
  if (!isPerformanceProfileDigestValid(profile))
    throw new TypeError(`performance profile ${profile.id}@${profile.version} has a stale digest`);
  if (new Set(profile.evidence).size !== profile.evidence.length)
    throw new TypeError(`performance profile ${profile.id} has duplicate evidence references`);
  return Object.freeze({ ...profile, evidence: Object.freeze([...profile.evidence].sort(compareText)) });
}

function familySignature(family: StrategyFamily): string {
  return family.candidates
    .map(
      (candidate) =>
        `${candidate.family}.${candidate.id}:${candidate.optimized}:${candidate.portability}:${[...candidate.evidence].sort().join(",")}`
    )
    .sort(compareText)
    .join("|");
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
