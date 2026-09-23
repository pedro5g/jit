import { resolvePerformanceProfile } from "../../performance/profile.js";
import { resolveDeploymentTargetProfile, resolveTargetProfile } from "../resolve-target.js";

describe("target profile resolution", () => {
  it.each([
    ["v22.18.0", "22"],
    ["v24.4.0", "24"],
    ["v26.0.0", "26"],
  ])("maps runtime %s to the checked-in Node %s profile", (node, major) => {
    const profile = resolveTargetProfile(undefined, {
      node,
      v8: "14.0.0",
      uv: "1.0.0",
      arch: "x64",
      platform: "linux",
    });

    expect(profile.id).toBe(`node-${major}`);
    expect(profile.fingerprint?.node).toBe(node);
  });

  it("resolves AOT targets without reading the build runtime", () => {
    const profile = resolveDeploymentTargetProfile({ runtime: "node", versions: "22" });

    expect(profile).toMatchObject({ id: "node-22", runtimeVersion: "22" });
    expect(profile.fingerprint).toBeUndefined();
  });

  it("uses the conservative limits shared by every profile in a Node range", () => {
    const profile = resolveDeploymentTargetProfile({ runtime: "node", versions: ">=24 <27" });

    expect(profile.id).toBe("node-range-24-26");
    expect(profile.limits.arrayUnrollMaxLength).toBe(8);
    expect(profile.fingerprint).toBeUndefined();
    expect(resolvePerformanceProfile(profile)).toMatchObject({ id: "jit-node-range-24-26", evidence: [] });
  });

  it.each(["portable-1", "node-22", "node-24", "node-26"])("uses a versioned performance profile for %s", (id) => {
    const profile = resolveTargetProfile({ profile: id });

    expect(resolvePerformanceProfile(profile)).toMatchObject({
      id: id === "portable-1" ? "jit-portable" : `jit-${id}`,
      version: "1",
      evidence: [],
    });
  });

  it("falls back to portable for an unknown or unbounded deployment range", () => {
    expect(resolveDeploymentTargetProfile({ runtime: "node", versions: ">=27" }).id).toBe("portable-1");
    expect(resolveDeploymentTargetProfile({ runtime: "node", versions: "not-a-range" }).id).toBe("portable-1");
  });

  it("ignores a runtime outside the reviewed engine profiles", () => {
    const profile = resolveTargetProfile(undefined, { node: "v25.2.0", v8: "14.0.0" });

    expect(profile.id).toBe("portable-1");
  });
});
