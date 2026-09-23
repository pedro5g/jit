/** Runtime facts captured with a performance measurement. */
export interface RuntimeFingerprint {
  readonly node?: string;
  readonly v8?: string;
  readonly uv?: string;
  readonly arch?: string;
  readonly platform?: string;
  readonly cpu?: string;
}

/** A compiler premise that must be checked by a reproducible benchmark. */
export interface PerformanceAssumption {
  readonly id: string;
  readonly hypothesis: string;
  readonly candidates: readonly string[];
  readonly dimensions: readonly string[];
  readonly usedBy: readonly string[];
}

/** Evidence accepted by a physical strategy decision. */
export interface PerformanceEvidence {
  readonly id: string;
  readonly assumption: string;
  readonly benchmark: string;
  readonly fingerprint: RuntimeFingerprint;
  readonly samples: number;
  readonly median: number;
  readonly dispersion: number;
  readonly ratio?: number;
  readonly commit?: string;
}

/** One immutable registry of assumptions and reviewed evidence. */
export interface PerformanceEvidenceRegistry {
  readonly assumptions: readonly PerformanceAssumption[];
  readonly evidence: readonly PerformanceEvidence[];
  assumption(id: string): PerformanceAssumption | undefined;
  evidenceById(id: string): PerformanceEvidence | undefined;
}

export function createPerformanceEvidenceRegistry(
  assumptions: readonly PerformanceAssumption[] = [],
  evidence: readonly PerformanceEvidence[] = []
): PerformanceEvidenceRegistry {
  const assumptionMap = new Map(assumptions.map((item) => [item.id, item]));
  const evidenceMap = new Map(evidence.map((item) => [item.id, item]));

  if (assumptionMap.size !== assumptions.length) throw new Error("duplicate performance assumption id");
  if (evidenceMap.size !== evidence.length) throw new Error("duplicate performance evidence id");
  for (const assumption of assumptions) validateAssumption(assumption);
  for (const item of evidence) {
    validateEvidence(item);
    if (!assumptionMap.has(item.assumption)) throw new Error(`unknown performance assumption ${item.assumption}`);
  }

  const registry: PerformanceEvidenceRegistry = {
    assumptions: Object.freeze([...assumptions]),
    evidence: Object.freeze([...evidence]),
    assumption: (id) => assumptionMap.get(id),
    evidenceById: (id) => evidenceMap.get(id),
  };
  return Object.freeze(registry);
}

function validateAssumption(assumption: PerformanceAssumption): void {
  if (!/^PERF-[A-Z0-9-]+$/.test(assumption.id)) throw new Error(`invalid performance assumption id ${assumption.id}`);
  if (assumption.hypothesis.length === 0 || assumption.candidates.length === 0 || assumption.usedBy.length === 0)
    throw new Error(`performance assumption ${assumption.id} is incomplete`);
}

function validateEvidence(item: PerformanceEvidence): void {
  if (!/^PERF-[A-Z0-9-]+$/.test(item.id)) throw new Error(`invalid performance evidence id ${item.id}`);
  if (!Number.isSafeInteger(item.samples) || item.samples < 1) throw new Error(`invalid samples for ${item.id}`);
  if (!Number.isFinite(item.median) || item.median < 0 || !Number.isFinite(item.dispersion) || item.dispersion < 0)
    throw new Error(`invalid measurements for ${item.id}`);
}
