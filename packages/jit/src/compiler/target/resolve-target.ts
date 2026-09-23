import { portableProfile } from "./portable-profile.js";
import { detectRuntimeFingerprint } from "./runtime-detector.js";
import type { TargetDescriptor, TargetProfile } from "./target-profile.js";
import { createV8Profile } from "./v8/profile.js";

/** Resolves an explicit target or a deterministic runtime profile. */
export function resolveTargetProfile(target?: TargetDescriptor): TargetProfile {
  if (target?.profile === "portable-1" || target?.runtime === "portable") return portableProfile;

  // A version range describes a deployment fleet, not the build machine. A
  // range without a reviewed profile therefore resolves conservatively.
  if (target?.versions !== undefined && target?.profile === undefined) return portableProfile;

  const fingerprint = detectRuntimeFingerprint();
  const major = majorV8(fingerprint.v8);
  if (target?.profile?.startsWith("v8-") && target.profile.slice(3).length > 0) {
    return createV8Profile(fingerprint, target.profile.slice(3));
  }
  if (target?.runtime === "node" && major !== undefined) return createV8Profile(fingerprint, major);
  if (target === undefined && major !== undefined) return createV8Profile(fingerprint, major);
  return portableProfile;
}

function majorV8(version: string | undefined): string | undefined {
  const match = version?.match(/^(\d+)/);
  return match?.[1];
}
