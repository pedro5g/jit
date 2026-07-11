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
    const selected = JIT.validator(User).get("is");
    const result = AOT.generate({ schemas: {}, functions: { User_is: selected.is }, outDir });

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
      const flat = loaded.User_is as (value: unknown) => boolean;

      expect(flat(ada)).toBe(true);
      expect(flat({ id: "x" })).toBe(false);
      expect(loaded.User).toBeUndefined();
    }
  });

  it("should expose flat per-operation exports by default", () => {
    const User = JIT.object({ id: JIT.number() });
    const selected = JIT.validator(User).get("is");

    AOT.generate({ schemas: {}, functions: { User_is: selected.is }, outDir });

    const source = readFileSync(join(outDir, "index.mjs"), "utf8");
    const types = readFileSync(join(outDir, "index.d.ts"), "utf8");

    expect(source).toMatch(/export \{ .*User_is.* \};/);
    expect(source).not.toMatch(/export \{[^}]*, User \};/);
    expect(source).not.toContain("const User = /*#__PURE__*/ Object.freeze({");
    expect(types).toContain("export declare const User_is: (value: unknown) => value is { id: number };");
    expect(types).not.toContain("export declare const User: {");
  });

  it("should expose grouped objects only for object-style compile markers", () => {
    const User = JIT.object({ id: JIT.number() });
    const selected = JIT.validator(User).get("is");

    AOT.generate({ schemas: { User: JIT.compile(User, { is: selected.is }) }, outDir });

    const source = readFileSync(join(outDir, "index.mjs"), "utf8");
    const types = readFileSync(join(outDir, "index.d.ts"), "utf8");

    expect(source).toContain("const User = /*#__PURE__*/ Object.freeze({");
    expect(source).toMatch(/export \{ User \};/);
    expect(source).not.toMatch(/export \{[^}]*User_is/);
    expect(types).not.toContain("export declare const User_is");
    expect(types).toContain("readonly is: (value: unknown) => value is User;");
  });

  it("should emit subpath modules, manifest, and plans when requested", async () => {
    const User = JIT.object({ id: JIT.number(), name: JIT.string() });
    const selected = JIT.validator(User).get("is");
    const schemaFile = join(outDir, "jit", "user.jit.ts");

    const result = AOT.generate({
      schemas: { User: JIT.compile(User, { is: selected.is }) },
      functions: { isUser: selected.is },
      sources: new Map([
        ["User", schemaFile],
        ["isUser", schemaFile],
      ]),
      outDir,
      emit: { subpathModules: true, manifest: true, plans: true },
      importSpecifier: "#jit",
    });
    const files = result.files.map((file) => file.split("/").pop()).sort();
    const manifest = JSON.parse(readFileSync(join(outDir, "manifest.json"), "utf8")) as {
      modules: readonly { readonly name: string; readonly import: string; readonly exports: readonly string[] }[];
      artifacts: readonly { readonly name: string; readonly module: string }[];
      files: readonly string[];
    };
    const plan = JSON.parse(readFileSync(join(outDir, "plans", "user.json"), "utf8")) as {
      module: string;
      artifacts: readonly { readonly name: string }[];
    };
    const generated = (await import(pathToFileURL(join(outDir, "user.mjs")).href)) as {
      User: { is: (value: unknown) => boolean };
      isUser: (value: unknown) => boolean;
    };

    expect(files).toContain("user.mjs");
    expect(files).toContain("manifest.json");
    expect(result.files).toContain(join(outDir, "plans", "user.json"));
    expect(readFileSync(join(outDir, "package.json"), "utf8")).toContain('"./user"');
    expect(readFileSync(join(outDir, "user.mjs"), "utf8")).toBe('export { User, isUser } from "./index.mjs";\n');
    expect(manifest.modules).toEqual([
      { name: "user", source: schemaFile, import: "#jit/user", exports: ["User", "isUser"] },
    ]);
    expect(manifest.artifacts.map((artifact) => `${artifact.module}:${artifact.name}`)).toEqual([
      "user:User",
      "user:isUser",
    ]);
    expect(manifest.files).toContain("plans/user.json");
    expect(plan.module).toBe("user");
    expect(plan.artifacts.map((artifact) => artifact.name)).toEqual(["User", "isUser"]);
    expect(generated.User.is({ id: 1, name: "Ada" })).toBe(true);
    expect(generated.isUser({ id: "x", name: "Ada" })).toBe(false);
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
    const selected = JIT.validator(User).get("is");
    const generated = join(outDir, "generated");
    const schemaFile = join(outDir, "src", "user.jit.ts");

    AOT.generate({
      schemas: { User: JIT.compile(User, { is: selected.is }) },
      sources: new Map([["User", schemaFile]]),
      outDir: generated,
    });

    const types = readFileSync(join(generated, "index.d.ts"), "utf8");

    expect(types).toContain('export type User = import("jit").Infer<typeof import("../src/user.jit.js").User>;');
    expect(types).toContain(
      'export type UserStrict<TValue> = import("jit").Strict<typeof import("../src/user.jit.js").User, TValue>;'
    );
    // No hand-emitted structural type when the source anchors the inference.
    expect(types).not.toContain("readonly id: number");
  });

  it("should fall back to structural types for programmatic schemas without sources", () => {
    const User = JIT.object({ id: JIT.number() });
    const selected = JIT.validator(User).get("is");

    AOT.generate({ schemas: { User: JIT.compile(User, { is: selected.is }) }, outDir });

    const types = readFileSync(join(outDir, "index.d.ts"), "utf8");

    expect(types).toContain("export type User = { id: number };");
    expect(types).toContain("export type UserStrict<TValue> = TValue;");
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

  it("should find *.jit.ts files recursively by default, skipping node_modules", () => {
    mkdirSync(join(projectDir, "src", "models"), { recursive: true });
    mkdirSync(join(projectDir, "node_modules", "pkg"), { recursive: true });
    writeFileSync(join(projectDir, "src", "models", "user.jit.mjs"), "export {};\n");
    writeFileSync(join(projectDir, "src", "order.jit.ts"), "export {};\n");
    writeFileSync(join(projectDir, "src", "not-a-schema.ts"), "export {};\n");
    writeFileSync(join(projectDir, "node_modules", "pkg", "dep.jit.mjs"), "export {};\n");

    const files = AOT.discoverSchemaFiles(projectDir);

    expect(files.map((file) => file.split("/").pop()).sort()).toEqual(["order.jit.ts"]);
    expect(
      AOT.discoverSchemaFiles(projectDir, ["**/*.jit.ts", "**/*.jit.mjs"])
        .map((file) => file.split("/").pop())
        .sort()
    ).toEqual(["order.jit.ts", "user.jit.mjs"]);
  });

  it("should collect exported AOT functions from files and reject name collisions", async () => {
    const schemaModule = [
      `import { JIT } from ${JSON.stringify(pathToFileURL(join(process.cwd(), "packages", "jit", "src", "index.ts")).href)};`,
      "const User = JIT.object({ id: JIT.number() });",
      "const selected = JIT.validator(User).get('is');",
      "export const User_is = selected.is;",
      "export const UserSchema = User;",
      "export const notASchema = 42;",
      "",
    ].join("\n");

    writeFileSync(join(projectDir, "user.jit.ts"), schemaModule);

    const collected = await AOT.collectSchemas([join(projectDir, "user.jit.ts")]);

    expect(Object.keys(collected.functions)).toEqual(["User_is"]);
    expect(Object.keys(collected.schemas)).toEqual([]);

    writeFileSync(join(projectDir, "dup.jit.ts"), schemaModule);

    await expect(AOT.collectSchemas([join(projectDir, "user.jit.ts"), join(projectDir, "dup.jit.ts")])).rejects.toThrow(
      /defined in both/
    );
  });

  it("should find jit.config files and type them via defineConfig", () => {
    writeFileSync(join(projectDir, "jit.config.mjs"), "export default {};\n");

    expect(AOT.findConfigFile(projectDir)).toBe(join(projectDir, "jit.config.mjs"));
    expect(AOT.findConfigFile(join(projectDir, "src"))).toBeUndefined();

    const config = AOT.defineConfig({
      schemas: ["src/models"],
      patterns: ["**/*.jit.ts"],
      outDir: "generated",
      packageName: "@acme/models",
      clean: true,
      emitPackageJson: true,
    });

    expect(config.packageName).toBe("@acme/models");
    expect(config.patterns).toEqual(["**/*.jit.ts"]);
  });
});
