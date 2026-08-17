import { JIT } from "@jit-compiler/jit/runtime";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { bundleUnits, topLevelNames } from "../bundle";
import { STARTER_PROJECT } from "../operations";
import { compilationOrder } from "../project";
import { entrypointLine, lockEntrypoint } from "../store";

/**
 * The project a first visit opens with, run the way the workspace runs it.
 *
 * It is two files where one composes a schema out of the other, which is the
 * whole point of the tree — and also the arrangement that breaks the moment
 * linking is wrong, because both files call their schema `schema`.
 */

function transpile(source: string): string {
  return ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, isolatedModules: true },
  }).outputText;
}

function bundle(path: string): string {
  return bundleUnits(
    compilationOrder(STARTER_PROJECT, path).map((file) => ({ path: file.path, code: transpile(file.source) }))
  );
}

describe("the starter project", () => {
  it("runs the file a first visit opens", () => {
    const result = new Function(
      "JIT",
      `"use strict";\n${bundle("user-schemas.ts")}\nreturn isUser({ id: 1, name: "Ada", email: "ada@lovelace.dev", role: "admin", tags: [] });`
    )(JIT);

    expect(result).toBe(true);
  });

  it("composes a schema out of another file", () => {
    const source = `${bundle("account-schemas.ts")}
return isAccount({
  id: "3f98c283-3de3-43a9-9ee8-bd00e3451475",
  owner: { id: 1, name: "Ada", email: "ada@lovelace.dev", role: "admin", tags: [] },
  plan: "pro",
  seats: 3,
});`;

    expect(new Function("JIT", `"use strict";\n${source}`)(JIT)).toBe(true);
  });

  it("declares something for the generator in every file", () => {
    for (const file of STARTER_PROJECT.files) {
      expect(topLevelNames(file.source).length, file.path).toBeGreaterThan(0);
    }
  });
});

describe("lockEntrypoint", () => {
  it("puts back an import the reader deleted", () => {
    expect(lockEntrypoint("const schema = JIT.string();", "run")).toBe(
      `${entrypointLine("run")}\n\nconst schema = JIT.string();`
    );
  });

  it("replaces a subpath the reader changed", () => {
    const edited = `import { JIT } from "@jit-compiler/jit/aot";\n\nconst schema = JIT.string();`;

    expect(lockEntrypoint(edited, "run")).toBe(`${entrypointLine("run")}\n\nconst schema = JIT.string();`);
  });

  it("survives a mangled binding rather than leaving two imports", () => {
    const mangled = `import { NOTJIT } from "@jit-compiler/jit/runtime";\n\nconst schema = JIT.string();`;
    const locked = lockEntrypoint(mangled, "run");

    expect(locked.match(/@jit-compiler\/jit/g)).toHaveLength(1);
    expect(locked).toContain(entrypointLine("run"));
  });

  it("changes nothing when the line is already right", () => {
    const source = `${entrypointLine("generate")}\n\nconst schema = JIT.string();`;

    expect(lockEntrypoint(source, "generate")).toBe(source);
  });

  it("keeps imports that are not the package's", () => {
    const source = `${entrypointLine("run")}\nimport { helper } from "./helper";\n\nconst schema = JIT.string();`;

    expect(lockEntrypoint(source, "run")).toContain('import { helper } from "./helper";');
  });
});
