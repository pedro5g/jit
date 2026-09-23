import { resolveNodeVersionRange } from "./node-range.js";
import { portableProfile } from "./portable-profile.js";
import { detectRuntimeFingerprint } from "./runtime-detector.js";
import type { TargetDescriptor, TargetProfile } from "./target-profile.js";
import { createNodeProfile, createV8Profile } from "./v8/profile.js";

const nodeProfileMajors = Object.freeze(["22", "24", "26"]);

/** Resolves an explicit target or a deterministic runtime profile. */
export function resolveTargetProfile(
  target?: TargetDescriptor,
  fingerprint: ReturnType<typeof detectRuntimeFingerprint> = detectRuntimeFingerprint()
): TargetProfile {
  if (target?.profile !== undefined) return resolveNamedProfile(target.profile, fingerprint);
  if (target?.runtime === "portable" || target?.runtime === "browser") return portableProfile;
  if (target?.versions !== undefined) return resolveDeploymentTargetProfile(target);

  const nodeMajor = majorNode(fingerprint.node);
  if ((target === undefined || target.runtime === "node") && nodeMajor !== undefined)
    return nodeProfileMajors.includes(nodeMajor) ? createNodeProfile(nodeMajor, fingerprint) : portableProfile;
  return portableProfile;
}

/** Resolves a deployment target without consulting the process that runs AOT. */
export function resolveDeploymentTargetProfile(target?: TargetDescriptor): TargetProfile {
  if (target?.profile !== undefined) return resolveNamedProfile(target.profile);
  if (target?.runtime === "portable" || target?.runtime === "browser" || target?.runtime === undefined)
    return portableProfile;
  if (target.runtime !== "node" || target.versions === undefined) return portableProfile;

  return resolveNodeVersionRange(target.versions);
}

function resolveNamedProfile(id: string, fingerprint?: ReturnType<typeof detectRuntimeFingerprint>): TargetProfile {
  if (id === "portable-1") return portableProfile;
  const node = /^node-(22|24|26)$/.exec(id);
  if (node?.[1] !== undefined) return createNodeProfile(node[1], fingerprint);
  const v8 = /^v8-(\d+)$/.exec(id);
  if (v8?.[1] !== undefined) return createV8Profile(fingerprint ?? {}, v8[1]);
  return portableProfile;
}

function majorNode(version: string | undefined): string | undefined {
  return version?.match(/^v?(\d+)/)?.[1];
}
