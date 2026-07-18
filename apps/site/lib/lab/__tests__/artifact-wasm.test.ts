import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import init, { inspect_token, pack_typescript } from "../generated/jit_artifact.js";

interface PackedArtifact {
  readonly token: string;
  readonly report: {
    readonly envelopeDigest: string;
    readonly files: readonly { readonly path: string; readonly bytes: number }[];
  };
}

beforeAll(async () => {
  const bytes = new Uint8Array(readFileSync(resolve(import.meta.dirname, "../generated/jit_artifact_bg.wasm")));
  await init({ module_or_path: bytes });
});

describe("browser artifact WASM", () => {
  it("packs and verifies the exact TypeScript bytes", () => {
    const packed = pack_typescript(
      [
        { path: "index.ts", source: "export const User = Object.freeze({});\n" },
        { path: "user.ts", source: 'export { User } from "./index.js";\n' },
      ],
      "src/generated/jit"
    ) as PackedArtifact;
    const inspected = inspect_token(packed.token) as PackedArtifact["report"];

    expect(packed.token).toMatch(/^jit1_/);
    expect(packed.report.files).toEqual([
      { path: "index.ts", bytes: 39, executable: false },
      { path: "user.ts", bytes: 35, executable: false },
    ]);
    expect(inspected.envelopeDigest).toBe(packed.report.envelopeDigest);
  });

  it("rejects token mutations before exposing files", () => {
    const packed = pack_typescript([{ path: "index.ts", source: "export {};\n" }], "generated") as PackedArtifact;

    expect(() => inspect_token(`${packed.token}A`)).toThrow();
  });
});
