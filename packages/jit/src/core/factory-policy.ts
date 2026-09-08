/** The only return shapes a Runtime Type factory can expose after declaration. */
export type FactoryReturnMode = "throw" | "either" | "tuple";

export type FactoryReturnModeInput = FactoryReturnMode;

export interface FactoryPolicyCandidate {
  readonly mode: FactoryReturnMode;
  readonly priority: number;
  readonly explicitMode: boolean;
  readonly depth: number;
  readonly source: string;
}

const MODE_RANK: Readonly<Record<FactoryReturnMode, number>> = Object.freeze({
  tuple: 0,
  either: 1,
  throw: 2,
});

/** Normalizes declaration syntax at the boundary; plans never carry `result`. */
export function normalizeFactoryReturnMode(mode: FactoryReturnModeInput): FactoryReturnMode {
  return mode;
}

/**
 * Chooses one deterministic inherited return policy. Numeric priority is the
 * primary key; the rank only resolves equal priorities.
 */
export function resolveFactoryReturnMode(candidates: readonly FactoryPolicyCandidate[]): FactoryReturnMode | undefined {
  return selectFactoryPolicyCandidate(candidates)?.mode;
}

/** Returns the complete winner so declaration planners can preserve priority metadata. */
export function selectFactoryPolicyCandidate(
  candidates: readonly FactoryPolicyCandidate[]
): FactoryPolicyCandidate | undefined {
  let selected: FactoryPolicyCandidate | undefined;
  for (const candidate of candidates) {
    if (
      selected === undefined ||
      candidate.priority > selected.priority ||
      (candidate.priority === selected.priority && MODE_RANK[candidate.mode] > MODE_RANK[selected.mode]) ||
      (candidate.priority === selected.priority &&
        MODE_RANK[candidate.mode] === MODE_RANK[selected.mode] &&
        (candidate.depth < selected.depth ||
          (candidate.depth === selected.depth && candidate.source < selected.source)))
    ) {
      selected = candidate;
    }
  }
  return selected;
}
