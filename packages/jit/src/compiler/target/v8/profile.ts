import type { RuntimeFingerprint, TargetProfile } from "../target-profile.js";

/** Creates a versioned V8 family profile; thresholds remain profile data. */
export function createV8Profile(fingerprint: RuntimeFingerprint, major: string): TargetProfile {
  const id = `v8-${major}`;
  return Object.freeze({
    id,
    runtime: "node" as const,
    engine: "v8" as const,
    engineVersion: major,
    digest: id,
    fingerprint,
    weights: Object.freeze({ runtime: 1, allocation: 10, setup: 3, codeSize: 2, cold: 2, branches: 0.25 }),
    limits: Object.freeze({
      arrayUnrollMaxLength: 8,
      arrayUnrollMaxBodyCost: 4,
      enumChainMaxCardinality: 6,
      enumSwitchMaxCardinality: 32,
    }),
    confidence: "medium" as const,
  });
}
