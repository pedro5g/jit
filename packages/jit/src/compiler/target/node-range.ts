import { portableProfile } from "./portable-profile.js";
import type { TargetProfile } from "./target-profile.js";
import { targetProfileDigest } from "./target-profile.js";
import { createNodeProfile } from "./v8/profile.js";

const reviewedMajors = Object.freeze(["22", "24", "26"]);

interface ParsedRange {
  readonly minimum: number;
  readonly maximum: number;
  covers(major: number): boolean;
}

interface RangeBounds {
  minimum: number;
  maximum: number;
  exact?: number;
}

/** Chooses one exact or conservative Node profile without consulting the host runtime. */
export function resolveNodeVersionRange(input: string): TargetProfile {
  const range = parseNodeMajorRange(input);
  if (range === undefined || !Number.isFinite(range.maximum) || range.minimum < Number(reviewedMajors[0]))
    return portableProfile;
  const matched = reviewedMajors.filter((major) => range.minimum <= Number(major) && Number(major) < range.maximum);
  if (matched.length === 0 || !matched.every((major) => range.covers(Number(major)))) return portableProfile;
  const profiles = matched.map((major) => createNodeProfile(major));
  return profiles.length === 1 ? (profiles[0] ?? portableProfile) : combineRangeProfiles(matched, profiles);
}

function parseNodeMajorRange(input: string): ParsedRange | undefined {
  const value = input.trim();
  const exact = exactMajor(value);
  if (exact !== undefined) return exact;
  const terms = readRangeTerms(value);
  if (terms === undefined) return undefined;
  const bounds = applyRangeTerms(terms);
  if (bounds === undefined) return undefined;
  return parsedBounds(bounds);
}

function exactMajor(value: string): ParsedRange | undefined {
  const match = /^(\d+)(?:\.x)?$/.exec(value);
  if (match?.[1] === undefined) return undefined;
  const major = Number(match[1]);
  return { minimum: major, maximum: major + 1, covers: (candidate) => candidate === major };
}

function readRangeTerms(value: string): readonly RegExpExecArray[] | undefined {
  const matcher = /(>=|>|<=|<|=|\^|~)?\s*(\d+)(?:\.\d+(?:\.\d+)?)?/g;
  const terms: RegExpExecArray[] = [];
  let cursor = 0;
  for (const match of value.matchAll(matcher)) {
    if (value.slice(cursor, match.index).trim().length > 0) return undefined;
    terms.push(match);
    cursor = (match.index ?? 0) + match[0].length;
  }
  return terms.length > 0 && value.slice(cursor).trim().length === 0 ? terms : undefined;
}

function applyRangeTerms(terms: readonly RegExpExecArray[]): RangeBounds | undefined {
  const bounds: RangeBounds = { minimum: 0, maximum: Number.POSITIVE_INFINITY };
  for (const term of terms) {
    if (!applyRangeTerm(bounds, term)) return undefined;
  }
  if (bounds.exact !== undefined && !(bounds.minimum <= bounds.exact && bounds.exact < bounds.maximum))
    return undefined;
  return bounds.minimum < bounds.maximum ? bounds : undefined;
}

function applyRangeTerm(bounds: RangeBounds, term: RegExpExecArray): boolean {
  const operator = term[1] ?? "=";
  const major = Number(term[2]);
  switch (operator) {
    case ">=":
      bounds.minimum = Math.max(bounds.minimum, major);
      return true;
    case ">":
      bounds.minimum = Math.max(bounds.minimum, major + 1);
      return true;
    case "<":
      bounds.maximum = Math.min(bounds.maximum, major);
      return true;
    case "<=":
      bounds.maximum = Math.min(bounds.maximum, major + 1);
      return true;
    case "^":
      bounds.minimum = Math.max(bounds.minimum, major);
      bounds.maximum = Math.min(bounds.maximum, major + 1);
      return true;
    case "=":
    case "~":
      if (bounds.exact !== undefined && bounds.exact !== major) return false;
      bounds.exact = major;
      bounds.minimum = Math.max(bounds.minimum, major);
      bounds.maximum = Math.min(bounds.maximum, major + 1);
      return true;
    default:
      return false;
  }
}

function parsedBounds(bounds: RangeBounds): ParsedRange {
  const minimum = Number.isFinite(bounds.minimum) ? bounds.minimum : 0;
  const maximum = Number.isFinite(bounds.maximum) ? bounds.maximum : Number.POSITIVE_INFINITY;
  return { minimum, maximum, covers: (major) => minimum <= major && major < maximum };
}

function combineRangeProfiles(majors: readonly string[], profiles: readonly TargetProfile[]): TargetProfile {
  const id = `node-range-${majors.join("-")}`;
  const runtimeVersion = majors.join("-");
  const weights = Object.freeze({
    runtime: extremeWeight(profiles, "runtime", Math.max),
    allocation: extremeWeight(profiles, "allocation", Math.max),
    setup: extremeWeight(profiles, "setup", Math.max),
    codeSize: extremeWeight(profiles, "codeSize", Math.max),
    cold: extremeWeight(profiles, "cold", Math.max),
    branches: extremeWeight(profiles, "branches", Math.max),
  });
  const limits = Object.freeze({
    arrayUnrollMaxLength: extremeLimit(profiles, "arrayUnrollMaxLength", Math.min),
    arrayUnrollMaxBodyCost: extremeLimit(profiles, "arrayUnrollMaxBodyCost", Math.min),
    enumChainMaxCardinality: extremeLimit(profiles, "enumChainMaxCardinality", Math.min),
    enumSwitchMaxCardinality: extremeLimit(profiles, "enumSwitchMaxCardinality", Math.min),
  });
  return Object.freeze({
    id,
    runtime: "node",
    engine: "v8",
    runtimeVersion,
    weights,
    limits,
    confidence: "medium",
    digest: targetProfileDigest({ id, runtime: "node", engine: "v8", runtimeVersion, weights, limits }),
  });
}

function extremeWeight(
  profiles: readonly TargetProfile[],
  key: keyof TargetProfile["weights"],
  select: (left: number, right: number) => number
): number {
  return profiles.reduce((result, profile) => select(result, profile.weights[key] ?? 0), select(0, 0));
}

function extremeLimit(
  profiles: readonly TargetProfile[],
  key: keyof TargetProfile["limits"],
  select: (left: number, right: number) => number
): number {
  const first = profiles[0]?.limits[key] ?? 0;
  return profiles.slice(1).reduce((result, profile) => select(result, profile.limits[key]), first);
}
