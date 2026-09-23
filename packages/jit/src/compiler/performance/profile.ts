/** Reviewed optimizer evidence admitted into one deterministic profile version. */
export interface PerformanceProfile {
  readonly id: string;
  readonly version: string;
  readonly digest: string;
  readonly evidence: readonly string[];
}

/** Portable policy admits no empirically optimized candidates until evidence is reviewed. */
export const portablePerformanceProfile = createPerformanceProfile({
  id: "jit-portable",
  version: "1",
  evidence: [],
});

/** Immutable performance policies are versioned independently for each deployment line. */
export const performanceProfiles = Object.freeze({
  portable: portablePerformanceProfile,
  node22: createPerformanceProfile({ id: "jit-node-22", version: "1", evidence: [] }),
  node24: createPerformanceProfile({ id: "jit-node-24", version: "1", evidence: [] }),
  node26: createPerformanceProfile({ id: "jit-node-26", version: "1", evidence: [] }),
});

/** Resolves a target-specific profile; ranges admit only evidence shared by every included line. */
export function resolvePerformanceProfile(target: { readonly id: string }): PerformanceProfile {
  const exact = performanceProfilesByTarget[target.id];
  if (exact !== undefined) return exact;
  const range = /^node-range-(22|24|26)(?:-(22|24|26))+$/.exec(target.id);
  if (range === null) return portablePerformanceProfile;
  const majors = target.id.slice("node-range-".length).split("-");
  const profiles = majors
    .map(profileForMajor)
    .filter((profile): profile is PerformanceProfile => profile !== undefined);
  if (profiles.length !== majors.length || profiles.length === 0) return portablePerformanceProfile;
  const shared = profiles[0]?.evidence.filter((id) => profiles.every((profile) => profile.evidence.includes(id))) ?? [];
  return createPerformanceProfile({ id: `jit-${target.id}`, version: "1", evidence: shared });
}

/** Creates a frozen profile with a digest derived from its normalized evidence set. */
export function createPerformanceProfile(input: {
  readonly id: string;
  readonly version: string;
  readonly evidence: readonly string[];
}): PerformanceProfile {
  if (input.id.length === 0 || input.version.length === 0)
    throw new TypeError("performance profiles require an id and version");
  const evidence = [...input.evidence].sort(compareText);
  if (new Set(evidence).size !== evidence.length)
    throw new TypeError(`performance profile ${input.id} has duplicate evidence`);
  if (evidence.some((id) => !/^PERF-[A-Z0-9-]+$/.test(id)))
    throw new TypeError(`performance profile ${input.id} has an invalid evidence id`);
  return Object.freeze({
    id: input.id,
    version: input.version,
    digest: digest(JSON.stringify([input.id, input.version, evidence])),
    evidence: Object.freeze(evidence),
  });
}

/** Initial profile; changing its evidence set requires a reviewed profile update. */
export const defaultPerformanceProfile = portablePerformanceProfile;

const performanceProfilesByTarget: Readonly<Record<string, PerformanceProfile>> = Object.freeze({
  "portable-1": performanceProfiles.portable,
  "node-22": performanceProfiles.node22,
  "node-24": performanceProfiles.node24,
  "node-26": performanceProfiles.node26,
});

function profileForMajor(major: string): PerformanceProfile | undefined {
  if (major === "22") return performanceProfiles.node22;
  if (major === "24") return performanceProfiles.node24;
  if (major === "26") return performanceProfiles.node26;
  return undefined;
}

/** Recomputes the profile digest to reject profile content changed under a stale digest. */
export function isPerformanceProfileDigestValid(profile: PerformanceProfile): boolean {
  return (
    profile.digest === digest(JSON.stringify([profile.id, profile.version, [...profile.evidence].sort(compareText)]))
  );
}

function digest(value: string): string {
  let first = 2166136261;
  let second = 2246822519;
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    first = Math.imul(first ^ code, 16777619);
    second = Math.imul(second ^ (code + index), 3266489917);
  }
  return `performance-${(first >>> 0).toString(16).padStart(8, "0")}${(second >>> 0).toString(16).padStart(8, "0")}`;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
