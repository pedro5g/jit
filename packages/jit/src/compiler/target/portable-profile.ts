import type { TargetProfile } from "./target-profile.js";

/** Conservative profile used when no supported engine can be identified. */
export const portableProfile: TargetProfile = Object.freeze({
  id: "portable-1",
  runtime: "portable",
  engine: "portable",
  digest: "portable-1",
  weights: Object.freeze({ runtime: 1, allocation: 8, setup: 3, codeSize: 4, cold: 2, branches: 0.5 }),
  limits: Object.freeze({
    arrayUnrollMaxLength: 4,
    arrayUnrollMaxBodyCost: 2,
    enumChainMaxCardinality: 4,
    enumSwitchMaxCardinality: 16,
  }),
  confidence: "fallback",
});
