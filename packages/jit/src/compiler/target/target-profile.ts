import type { RuntimeFingerprint } from "../performance/evidence.js";

/** Runtime family understood by the physical planner. */
export type TargetRuntime = "node" | "browser" | "portable";

/** Explicit target request accepted by runtime/AOT toolchains. */
export interface TargetDescriptor {
  readonly runtime?: TargetRuntime;
  /** Deployment runtime version/range; never interpreted using the build host. */
  readonly versions?: string;
  readonly profile?: string;
}

/** Runtime facts used for diagnostics and performance reports. */
export type { RuntimeFingerprint } from "../performance/evidence.js";

/** Target-specific weights and bounded strategy policies. */
export interface TargetProfile {
  readonly id: string;
  readonly runtime: TargetRuntime;
  readonly engine: "v8" | "portable";
  readonly runtimeVersion?: string;
  readonly engineVersion?: string;
  readonly digest: string;
  readonly fingerprint?: RuntimeFingerprint;
  readonly weights: Readonly<{
    runtime: number;
    allocation: number;
    setup: number;
    codeSize: number;
    cold: number;
    branches?: number;
  }>;
  readonly limits: Readonly<{
    arrayUnrollMaxLength: number;
    arrayUnrollMaxBodyCost: number;
    enumChainMaxCardinality: number;
    enumSwitchMaxCardinality: number;
  }>;
  readonly confidence: "high" | "medium" | "fallback";
}

/** Stable digest of the reviewed target selection policy, independent of host facts. */
export function targetProfileDigest(input: {
  readonly id: string;
  readonly runtime: TargetRuntime;
  readonly engine: "v8" | "portable";
  readonly runtimeVersion?: string;
  readonly weights: TargetProfile["weights"];
  readonly limits: TargetProfile["limits"];
}): string {
  const source = JSON.stringify({
    id: input.id,
    runtime: input.runtime,
    engine: input.engine,
    runtimeVersion: input.runtimeVersion,
    weights: input.weights,
    limits: input.limits,
  });
  let first = 2166136261;
  let second = 2246822519;
  for (let index = 0; index < source.length; index++) {
    const code = source.charCodeAt(index);
    first = Math.imul(first ^ code, 16777619);
    second = Math.imul(second ^ (code + index), 3266489917);
  }
  return `target-${(first >>> 0).toString(16).padStart(8, "0")}${(second >>> 0).toString(16).padStart(8, "0")}`;
}

/** Rejects mutable, stale, or non-normalized profile inputs before candidate ranking. */
export function assertTargetProfile(profile: TargetProfile): TargetProfile {
  for (const key of ["runtime", "allocation", "setup", "codeSize", "cold", "branches"] as const) {
    const value = profile.weights[key];
    if (value === undefined) continue;
    if (!Number.isSafeInteger(value) || value < 0)
      throw new TypeError(`target profile ${profile.id} weight ${key} must be a non-negative integer`);
  }
  for (const [key, value] of Object.entries(profile.limits)) {
    if (!Number.isSafeInteger(value) || value < 0)
      throw new TypeError(`target profile ${profile.id} limit ${key} must be a non-negative integer`);
  }
  const expected = targetProfileDigest(profile);
  if (profile.digest !== expected) throw new TypeError(`target profile ${profile.id} has a stale digest`);
  return profile;
}
