import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  createStoredArtifact,
  identityFromPrivateKey,
  parseReference,
  parseStoredArtifact,
  publicKeyFromBase64,
  signReference,
  verifyReference,
} from "../registry/protocol.js";

describe("Lab artifact registry protocol", () => {
  it("canonicalizes, hashes and verifies exact generated files", () => {
    const generated = createStoredArtifact(
      [
        { path: "user.generated.ts", source: "export const value = 1;\n" },
        { path: "types.d.ts", source: "export type Value = number;\n" },
      ],
      "src/generated/jit"
    );

    expect(generated.hash).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(parseStoredArtifact(generated.bytes, generated.hash).artifact).toEqual(generated.artifact);
    expect(() =>
      parseStoredArtifact(
        Buffer.from(Buffer.from(generated.bytes).toString("utf8").replace("value = 1", "value = 2")),
        generated.hash
      )
    ).toThrow(/hash/);
  });

  it("creates a compact signed reconstruction reference", () => {
    const identity = identityFromPrivateKey(generateKeyPairSync("ed25519").privateKey);
    const token = signReference(
      {
        hash: "A".repeat(43),
        outputRoot: "src/generated/jit",
        registry: "https://jit.example",
      },
      identity
    );

    expect(token).toMatch(/^jlr1_/);
    expect(token.length).toBeLessThan(340);
    expect(parseReference(token).reference.outputRoot).toBe("src/generated/jit");
    expect(verifyReference(token, publicKeyFromBase64(identity.publicKey))).toMatchObject({
      hash: "A".repeat(43),
      keyId: identity.keyId,
      registry: "https://jit.example",
    });

    const separator = token.lastIndexOf(".");
    const signature = token.slice(separator + 1);
    const tampered = `${token.slice(0, separator + 1)}${signature.startsWith("A") ? "B" : "A"}${signature.slice(1)}`;
    expect(() => verifyReference(tampered, publicKeyFromBase64(identity.publicKey))).toThrow(/signature/);
  });

  it("rejects traversal and duplicate output paths", () => {
    expect(() => createStoredArtifact([{ path: "../escape.ts", source: "" }], "src/generated")).toThrow(/Unsafe/);
    expect(() =>
      createStoredArtifact(
        [
          { path: "same.ts", source: "one" },
          { path: "same.ts", source: "two" },
        ],
        "src/generated"
      )
    ).toThrow(/unique/);
  });
});
