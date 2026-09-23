import type { StrategyCandidate } from "./candidate.js";

/** Named family of interchangeable, semantics-checked physical candidates. */
export interface StrategyFamily {
  readonly id: string;
  readonly candidates: readonly StrategyCandidate[];
}

/** Creates a frozen strategy family. */
export function createStrategyFamily(id: string, candidates: readonly StrategyCandidate[]): StrategyFamily {
  if (id.length === 0) throw new TypeError("strategy families require a stable id");
  const ids = new Set<string>();
  for (const candidate of candidates) {
    if (candidate.id.length === 0 || candidate.family !== id)
      throw new TypeError(`strategy ${candidate.id || "<anonymous>"} must declare family ${id}`);
    if (candidate.portability !== "portable" && candidate.portability !== "target-specific")
      throw new TypeError(`strategy ${id}.${candidate.id} must declare target portability`);
    if (ids.has(candidate.id)) throw new TypeError(`strategy family ${id} has duplicate candidate ${candidate.id}`);
    ids.add(candidate.id);
    if (candidate.optimized && candidate.evidence.length === 0)
      throw new TypeError(`optimized strategy ${id}.${candidate.id} requires performance evidence`);
    if (typeof candidate.legality !== "function" || typeof candidate.targetSupport !== "function")
      throw new TypeError(`strategy ${id}.${candidate.id} must declare semantic legality and target support`);
  }
  return Object.freeze({ id, candidates: Object.freeze([...candidates]) });
}
