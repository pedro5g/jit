import { detectRuntimeFingerprint } from "../runtime-detector.js";

describe("runtime fingerprint detection", () => {
  it("captures the Node engine before code generation without normalizing away details", () => {
    const fingerprint = detectRuntimeFingerprint();

    expect(fingerprint).toMatchObject({
      node: process.version,
      v8: process.versions.v8,
      uv: process.versions.uv,
      arch: process.arch,
      platform: process.platform,
    });
  });
});
