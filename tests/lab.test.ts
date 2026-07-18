import { describe, expect, it } from "vitest";
import { compileLabArtifact } from "../apps/site/lib/lab/compile.js";

describe("JIT Lab compiler", () => {
  it("compiles a closed schema request into typed import-free TypeScript", () => {
    const result = compileLabArtifact({
      name: "User",
      outputRoot: "src/generated/jit",
      fields: [
        { name: "id", type: "integer", required: true, min: 1 },
        { name: "email", type: "string", required: true, format: "email" },
        { name: "tags", type: "stringArray", required: false, max: 8 },
      ],
      operations: ["is", "parse", "stringify"],
    });
    const source = result.files[0]?.source ?? "";

    expect(result.files).toHaveLength(1);
    expect(result.files[0]?.path).toBe("index.ts");
    expect(source).toContain("export type User =");
    expect(source).toContain("const User: {");
    expect(source).toContain("readonly is:");
    expect(source).toContain("readonly parse:");
    expect(source).toContain("readonly stringify:");
    expect(source).not.toContain('from "@jit-compiler/jit"');
    expect(result.schemaSource).toContain("email: JIT.string().email()");
    expect(result.schemaSource).toContain("tags: JIT.array(JIT.string()).max(8).optional()");
  });

  it("rejects open-ended code, unsafe paths and duplicate fields", () => {
    expect(() =>
      compileLabArtifact({
        name: "User; process.exit()",
        outputRoot: "../outside",
        fields: [{ name: "id", type: "number", required: true }],
        operations: ["is"],
      })
    ).toThrow(/identifier/);

    expect(() =>
      compileLabArtifact({
        name: "User",
        outputRoot: "src/generated",
        fields: [
          { name: "id", type: "number", required: true },
          { name: "id", type: "string", required: true },
        ],
        operations: ["is"],
      })
    ).toThrow(/duplicate field/);
  });

  it("rejects contradictory field constraints", () => {
    expect(() =>
      compileLabArtifact({
        name: "Flags",
        outputRoot: "src/generated",
        fields: [{ name: "enabled", type: "boolean", required: true, min: 1 }],
        operations: ["is"],
      })
    ).toThrow(/bounds/);

    expect(() =>
      compileLabArtifact({
        name: "Profile",
        outputRoot: "src/generated",
        fields: [{ name: "score", type: "number", required: true, min: 10, max: 2 }],
        operations: ["is"],
      })
    ).toThrow(/cannot exceed/);
  });
});
