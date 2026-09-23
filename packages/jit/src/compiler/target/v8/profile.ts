import type { RuntimeFingerprint, TargetProfile } from "../target-profile.js";
import { targetProfileDigest } from "../target-profile.js";

/** Creates a versioned V8 family profile; thresholds remain profile data. */
export function createV8Profile(fingerprint: RuntimeFingerprint, major: string): TargetProfile {
  const id = `v8-${major}`;
  return Object.freeze({
    id,
    runtime: "node" as const,
    engine: "v8" as const,
    engineVersion: major,
    fingerprint,
    weights: Object.freeze({
      runtime: 1000,
      allocation: 10_000,
      setup: 3000,
      codeSize: 2000,
      cold: 2000,
      branches: 250,
    }),
    limits: Object.freeze({
      arrayUnrollMaxLength: 8,
      arrayUnrollMaxBodyCost: 4,
      enumChainMaxCardinality: 6,
      enumSwitchMaxCardinality: 32,
    }),
    confidence: "medium" as const,
    digest: targetProfileDigest({
      id,
      runtime: "node",
      engine: "v8",
      weights: { runtime: 1000, allocation: 10_000, setup: 3000, codeSize: 2000, cold: 2000, branches: 250 },
      limits: {
        arrayUnrollMaxLength: 8,
        arrayUnrollMaxBodyCost: 4,
        enumChainMaxCardinality: 6,
        enumSwitchMaxCardinality: 32,
      },
    }),
  });
}

/** Creates a checked-in Node major profile without binding its digest to the build host. */
export function createNodeProfile(major: string, fingerprint?: RuntimeFingerprint): TargetProfile {
  const id = `node-${major}`;
  const v8 = fingerprint?.v8?.match(/^(\d+)/)?.[1];
  return Object.freeze({
    id,
    runtime: "node" as const,
    engine: "v8" as const,
    runtimeVersion: major,
    ...(v8 === undefined ? {} : { engineVersion: v8 }),
    ...(fingerprint === undefined ? {} : { fingerprint }),
    weights: Object.freeze({
      runtime: 1000,
      allocation: 10_000,
      setup: 3000,
      codeSize: 2000,
      cold: 2000,
      branches: 250,
    }),
    limits: Object.freeze({
      arrayUnrollMaxLength: 8,
      arrayUnrollMaxBodyCost: 4,
      enumChainMaxCardinality: 6,
      enumSwitchMaxCardinality: 32,
    }),
    confidence: "medium" as const,
    digest: targetProfileDigest({
      id,
      runtime: "node",
      engine: "v8",
      runtimeVersion: major,
      weights: { runtime: 1000, allocation: 10_000, setup: 3000, codeSize: 2000, cold: 2000, branches: 250 },
      limits: {
        arrayUnrollMaxLength: 8,
        arrayUnrollMaxBodyCost: 4,
        enumChainMaxCardinality: 6,
        enumSwitchMaxCardinality: 32,
      },
    }),
  });
}
