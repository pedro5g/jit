import type { RuntimeFingerprint } from "../performance/evidence.js";

/** Runtime family understood by the physical planner. */
export type TargetRuntime = "node" | "browser" | "portable";

/** Explicit target request accepted by runtime/AOT toolchains. */
export interface TargetDescriptor {
  readonly runtime?: TargetRuntime;
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
