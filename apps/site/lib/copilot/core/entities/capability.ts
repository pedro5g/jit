/**
 * What this browser can actually do, as a level rather than a set of booleans.
 *
 * §78 and §79 make progressive capability a design rule instead of a fallback
 * path: the copilot is never broken, it is one of five working products. A
 * phone with no WebGPU gets documentation search that is genuinely good —
 * exact symbol lookup and BM25 over a precompiled index, which answers most
 * API questions on its own. A laptop with WebGPU and a gigabyte to spare gets
 * the whole thing.
 *
 * Expressed as an ordered level because every consumer asks the same question
 * — is at least X available — and a bag of flags makes each of them re-derive
 * the ordering, differently.
 */
export const CAPABILITY_LEVELS = [
  /** Lexical and exact-symbol search over the shipped index. Always available. */
  "search",
  /** Plus semantic retrieval: the embedding model is loaded. */
  "hybrid-search",
  /** Plus generated explanations from a local model. */
  "explain",
  /** Plus deterministic navigation actions the model can emit. */
  "navigate",
  /** Plus structured schema generation, validated by JIT itself. */
  "generate",
] as const;

export type CapabilityLevel = (typeof CAPABILITY_LEVELS)[number];

/** A measured model profile, independent from parameter count or tier names. */
export type ModelCapabilityLevel = "unmeasured" | "unsupported" | "weak" | "acceptable" | "strong";

export interface ModelCapabilityProfile {
  navigation: ModelCapabilityLevel;
  lookup: ModelCapabilityLevel;
  explain: ModelCapabilityLevel;
  deepExplain: ModelCapabilityLevel;
  groundedSynthesis: ModelCapabilityLevel;
  portuguese: ModelCapabilityLevel;
  english: ModelCapabilityLevel;
}

export function atLeast(level: CapabilityLevel, required: CapabilityLevel): boolean {
  return CAPABILITY_LEVELS.indexOf(level) >= CAPABILITY_LEVELS.indexOf(required);
}

/**
 * What the environment offers, before anything is downloaded.
 *
 * `deviceMemory` and the mobile flag are §77's first-class constraints. A
 * 4 GB phone can report WebGPU support and then be killed by the browser
 * halfway through loading a gigabyte of weights, which presents to the reader
 * as the tab dying — so the tier is capped rather than the download attempted.
 */
export interface EnvironmentCapabilities {
  webgpu: boolean;
  chromeBuiltIn: boolean;
  /** navigator.deviceMemory in GB, when the browser reports it. */
  deviceMemoryGb?: number;
  mobile: boolean;
  /** Vectors shipped with the artifacts and loaded successfully. */
  vectors: boolean;
}

export interface CapabilityReport {
  level: CapabilityLevel;
  environment: EnvironmentCapabilities;
  /**
   * Why the level is what it is, in one sentence a reader can act on.
   *
   * §80: never hide a limitation. "Search and navigation remain enabled"
   * is a different message from "this browser has no WebGPU", and the reader
   * deserves the second one when it is true.
   */
  reason: string;
}
