import { describe, expect, it } from "vitest";
import { schemaBody, withEntrypoint } from "../store";

const RUNTIME = 'import { JIT } from "@jit-compiler/jit/runtime";';
const DEFINE = 'import { JIT } from "@jit-compiler/jit/define";';

describe("withEntrypoint", () => {
  it("rewrites a runtime import for the generator", () => {
    const code = `${RUNTIME}\n\nconst User = JIT.object({});`;

    expect(withEntrypoint(code, "generate")).toBe(`${DEFINE}\n\nconst User = JIT.object({});`);
  });

  it("rewrites a define import back for running", () => {
    const code = `${DEFINE}\n\nconst User = JIT.object({});`;

    expect(withEntrypoint(code, "run")).toBe(`${RUNTIME}\n\nconst User = JIT.object({});`);
  });

  it("adds the import when the reader pasted a bare schema", () => {
    expect(withEntrypoint("const User = JIT.object({});", "run")).toBe(`${RUNTIME}\n\nconst User = JIT.object({});`);
  });

  it("leaves the rest of the source untouched, imports included", () => {
    const code = `${RUNTIME}\nimport { z } from "zod";\n\nconst User = JIT.object({});`;

    expect(withEntrypoint(code, "generate")).toContain('import { z } from "zod";');
  });

  it("is what the two modes disagree about, and nothing else", () => {
    const code = `${RUNTIME}\n\nconst User = JIT.object({});`;

    expect(schemaBody(withEntrypoint(code, "run"))).toBe(schemaBody(withEntrypoint(code, "generate")));
  });
});

describe("schemaBody", () => {
  it("strips the import so the ghost sees only the declarations", () => {
    expect(schemaBody(`${RUNTIME}\n\nconst User = JIT.object({});`)).toBe("const User = JIT.object({});");
  });
});
