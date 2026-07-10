import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { AOT, JIT } from "../../index.js";

describe("JIT AOT dual output and tree-shakable exports", () => {
  let outDir: string;

  beforeEach(() => {
    outDir = mkdtempSync(join(tmpdir(), "jit-aot-dx-"));
  });

  afterEach(() => {
    rmSync(outDir, { recursive: true, force: true });
  });

  it("should emit esm + cjs + dual type declarations with an exports map", async () => {
    const User = JIT.object({ id: JIT.number(), name: JIT.string() });
    const result = AOT.generate({ schemas: { User }, outDir });

    expect(result.files.map((file) => file.split("/").pop())).toEqual([
      "index.mjs",
      "index.cjs",
      "index.d.ts",
      "index.d.cts",
      "package.json",
    ]);

    const manifest = JSON.parse(readFileSync(join(outDir, "package.json"), "utf8")) as {
      exports: Record<string, { import?: string; require?: string }>;
      sideEffects: boolean;
    };

    expect(manifest.exports["."].import).toBe("./index.mjs");
    expect(manifest.exports["."].require).toBe("./index.cjs");
    expect(manifest.sideEffects).toBe(false);

    // Both formats load and agree.
    const esm = (await import(pathToFileURL(join(outDir, "index.mjs")).href)) as Record<string, unknown>;
    const require = createRequire(import.meta.url);
    const cjs = require(join(outDir, "index.cjs")) as Record<string, unknown>;
    const ada = { id: 1, name: "Ada" };

    for (const loaded of [esm, cjs]) {
      const namespace = loaded.User as { is: (value: unknown) => boolean };
      const flat = loaded.User_is as (value: unknown) => boolean;

      expect(namespace.is(ada)).toBe(true);
      expect(flat(ada)).toBe(true);
      expect(flat({ id: "x" })).toBe(false);
    }
  });

  it("should expose flat per-operation exports and a pure namespace aggregation", () => {
    const User = JIT.object({ id: JIT.number() });

    AOT.generate({ schemas: { User }, outDir });

    const source = readFileSync(join(outDir, "index.mjs"), "utf8");
    const types = readFileSync(join(outDir, "index.d.ts"), "utf8");

    expect(source).toContain("const User = /*#__PURE__*/ Object.freeze({");
    expect(source).toMatch(/export \{ .*User_is, .*User \};/);
    expect(types).toContain("export declare const User_is: (value: unknown) => value is User;");
    expect(types).toContain("readonly is: typeof User_is;");
  });
});

describe("JIT AOT inference-anchored types", () => {
  let outDir: string;

  beforeEach(() => {
    outDir = mkdtempSync(join(tmpdir(), "jit-aot-infer-"));
  });

  afterEach(() => {
    rmSync(outDir, { recursive: true, force: true });
  });

  it('should derive .d.ts types from the dev schema file via import("jit").Infer', () => {
    const User = JIT.object({ id: JIT.number(), name: JIT.string() });
    const generated = join(outDir, "generated");
    const schemaFile = join(outDir, "src", "user.jit.ts");

    AOT.generate({
      schemas: { User },
      sources: new Map([["User", schemaFile]]),
      outDir: generated,
    });

    const types = readFileSync(join(generated, "index.d.ts"), "utf8");

    expect(types).toContain('export type User = import("jit").Infer<typeof import("../src/user.jit.js").User>;');
    // No hand-emitted structural type when the source anchors the inference.
    expect(types).not.toContain("readonly id: number");
  });

  it("should fall back to structural types for programmatic schemas without sources", () => {
    const User = JIT.object({ id: JIT.number() });

    AOT.generate({ schemas: { User }, outDir });

    const types = readFileSync(join(outDir, "index.d.ts"), "utf8");

    expect(types).toContain("export type User = { id: number };");
  });

  it("should expose JIT.infer for builders and schemas", () => {
    const User = JIT.object({ id: JIT.number(), tags: JIT.array(JIT.string()) });

    expectTypeOf<JIT.infer<typeof User>>().toEqualTypeOf<{
      id: number;
      tags: string[];
    }>();
    expectTypeOf<JIT.infer<typeof User.schema>>().toEqualTypeOf<JIT.infer<typeof User>>();
  });
});

describe("JIT AOT schema discovery", () => {
  let projectDir: string;

  beforeEach(() => {
    projectDir = mkdtempSync(join(tmpdir(), "jit-discover-"));
  });

  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true });
  });

  it("should find *.jit.* files recursively, skipping node_modules", () => {
    mkdirSync(join(projectDir, "src", "models"), { recursive: true });
    mkdirSync(join(projectDir, "node_modules", "pkg"), { recursive: true });
    writeFileSync(join(projectDir, "src", "models", "user.jit.mjs"), "export {};\n");
    writeFileSync(join(projectDir, "src", "order.jit.ts"), "export {};\n");
    writeFileSync(join(projectDir, "src", "not-a-schema.ts"), "export {};\n");
    writeFileSync(join(projectDir, "node_modules", "pkg", "dep.jit.mjs"), "export {};\n");

    const files = AOT.discoverSchemaFiles(projectDir);

    expect(files.map((file) => file.split("/").pop()).sort()).toEqual(["order.jit.ts", "user.jit.mjs"]);
  });

  it("should collect exported schemas from files and reject name collisions", async () => {
    // A structural schema stand-in keeps the fixture free of engine imports.
    const schemaModule = [
      'export const User = { type: "object", def: { props: {} } };',
      "export const notASchema = 42;",
      "",
    ].join("\n");

    writeFileSync(join(projectDir, "user.jit.mjs"), schemaModule);

    const collected = await AOT.collectSchemas([join(projectDir, "user.jit.mjs")]);

    expect(Object.keys(collected.schemas)).toEqual(["User"]);

    writeFileSync(join(projectDir, "dup.jit.mjs"), schemaModule);

    await expect(
      AOT.collectSchemas([join(projectDir, "user.jit.mjs"), join(projectDir, "dup.jit.mjs")])
    ).rejects.toThrow(/defined in both/);
  });

  it("should find jit.config files and type them via defineConfig", () => {
    writeFileSync(join(projectDir, "jit.config.mjs"), "export default {};\n");

    expect(AOT.findConfigFile(projectDir)).toBe(join(projectDir, "jit.config.mjs"));
    expect(AOT.findConfigFile(join(projectDir, "src"))).toBeUndefined();

    const config = AOT.defineConfig({ schemas: ["src/models"], outDir: "generated", packageName: "@acme/models" });

    expect(config.packageName).toBe("@acme/models");
  });
});
