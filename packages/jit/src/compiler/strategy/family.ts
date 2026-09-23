import type { StrategyCandidate } from "./candidate.js";

/** Named family of interchangeable, semantics-checked physical candidates. */
export interface StrategyFamily {
  readonly id: string;
  readonly candidates: readonly StrategyCandidate[];
}

/** Creates a frozen strategy family. */
export function createStrategyFamily(id: string, candidates: readonly StrategyCandidate[]): StrategyFamily {
  if (id.length === 0) throw new TypeError("strategy families require a stable id");
  for (const candidate of candidates) {
    if (candidate.id.length === 0 || candidate.evidence.length === 0)
      throw new TypeError(`strategy ${candidate.id || "<anonymous>"} requires performance evidence`);
  }
  return Object.freeze({ id, candidates: Object.freeze([...candidates]) });
}
