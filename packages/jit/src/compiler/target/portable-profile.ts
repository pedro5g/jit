import { type TargetProfile, targetProfileDigest } from "./target-profile.js";

/** Conservative profile used when no supported engine can be identified. */
export const portableProfile: TargetProfile = Object.freeze({
  id: "portable-1",
  runtime: "portable",
  engine: "portable",
  weights: Object.freeze({ runtime: 1000, allocation: 8000, setup: 3000, codeSize: 4000, cold: 2000, branches: 500 }),
  limits: Object.freeze({
    arrayUnrollMaxLength: 4,
    arrayUnrollMaxBodyCost: 2,
    enumChainMaxCardinality: 4,
    enumSwitchMaxCardinality: 16,
  }),
  confidence: "fallback",
  digest: targetProfileDigest({
    id: "portable-1",
    runtime: "portable",
    engine: "portable",
    weights: { runtime: 1000, allocation: 8000, setup: 3000, codeSize: 4000, cold: 2000, branches: 500 },
    limits: {
      arrayUnrollMaxLength: 4,
      arrayUnrollMaxBodyCost: 2,
      enumChainMaxCardinality: 4,
      enumSwitchMaxCardinality: 16,
    },
  }),
});
