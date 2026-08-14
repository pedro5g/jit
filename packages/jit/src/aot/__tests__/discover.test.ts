import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { AOT, JIT } from "../../index.js";

describe("JIT AOT source output and tree-shakable exports", () => {
  let outDir: string;

  beforeEach(() => {
    outDir = mkdtempSync(join(tmpdir(), "jit-aot-dx-"));
  });

  afterEach(() => {
    rmSync(outDir, { recursive: true, force: true });
  });

  it("should emit one ready-to-run JavaScript package with an exports map", async () => {
    const User = JIT.object({ id: JIT.number(), name: JIT.string() });
    const isUser = JIT.is(User);
    const packageDir = join(outDir, "node_modules", "@jit", "generated");
    const result = AOT.generate({
      schemas: {},
      functions: { User_is: isUser },
      outDir: packageDir,
    });

    expect(result.files.map((file) => file.split("/").pop())).toEqual(["index.js", "package.json"]);

    const manifest = JSON.parse(readFileSync(join(packageDir, "package.json"), "utf8")) as {
      exports: Record<string, string>;
      sideEffects: boolean;
    };

    expect(manifest.exports["."]).toBe("./index.js");
    expect(manifest.sideEffects).toBe(false);

    const generated = (await import(pathToFileURL(join(packageDir, "index.js")).href)) as Record<string, unknown>;
    const ada = { id: 1, name: "Ada" };
    const flat = generated.User_is as (value: unknown) => boolean;

    expect(flat(ada)).toBe(true);
    expect(flat({ id: "x" })).toBe(false);
    expect(generated.User).toBeUndefined();
  });

  it("should expose flat per-operation exports by default", () => {
    const User = JIT.object({ id: JIT.number() });
    const isUser = JIT.is(User);

    AOT.generate({ schemas: {}, functions: { User_is: isUser }, outDir, format: "typescript" });

    const source = readFileSync(join(outDir, "index.ts"), "utf8");

    expect(source).toMatch(/export \{ .*User_is.* \};/);
    expect(source).not.toMatch(/export \{[^}]*, User \};/);
    expect(source).not.toContain("const User = /*#__PURE__*/ Object.freeze({");
    expect(source).toContain("const User_is: (value: unknown) => value is { id: number } =");
    expect(source).not.toContain("const User: {");
  });

  it("should expose grouped objects only for object-style compile markers", () => {
    const User = JIT.object({ id: JIT.number() });
    const isUser = JIT.is(User);

    AOT.generate({
      schemas: { User: JIT.compile(User, { is: isUser }) },
      outDir,
      format: "typescript",
    });

    const source = readFileSync(join(outDir, "index.ts"), "utf8");

    expect(source).toContain("} = /*#__PURE__*/ Object.freeze({");
    expect(source).toMatch(/export \{ User \};/);
    expect(source).not.toMatch(/export \{[^}]*User_is/);
    expect(source).not.toContain("const User_is:");
    expect(source).toContain("readonly is: (value: unknown) => value is User;");
  });

  it("should emit subpath modules, manifest, and plans when requested", async () => {
    const User = JIT.object({ id: JIT.number(), name: JIT.string() });
    const isUser = JIT.is(User);
    const schemaFile = join(outDir, "jit", "user.jit.ts");

    const result = AOT.generate({
      schemas: { User: JIT.compile(User, { is: isUser }) },
      functions: { isUser: isUser },
      sources: new Map([
        ["User", schemaFile],
        ["isUser", schemaFile],
      ]),
      outDir,
      emit: { subpathModules: true, manifest: true, plans: true },
    });
    const files = result.files.map((file) => file.split("/").pop()).sort();
    const manifest = JSON.parse(readFileSync(join(outDir, "manifest.json"), "utf8")) as {
      version: number;
      modules: readonly {
        readonly name: string;
        readonly import: string;
        readonly exports: readonly string[];
      }[];
      artifacts: readonly { readonly name: string; readonly module: string }[];
      files: readonly string[];
    };
    const plan = JSON.parse(readFileSync(join(outDir, "plans", "user.json"), "utf8")) as {
      module: string;
      artifacts: readonly { readonly name: string }[];
    };
    const generated = (await import(pathToFileURL(join(outDir, "user.js")).href)) as {
      User: { is: (value: unknown) => boolean };
      isUser: (value: unknown) => boolean;
    };

    expect(files).toContain("user.js");
    expect(manifest.version).toBe(2);
    expect(files).toContain("manifest.json");
    expect(result.files).toContain(join(outDir, "plans", "user.json"));
    const subpath = readFileSync(join(outDir, "user.js"), "utf8");
    expect(subpath).toContain("function is(value)");
    expect(subpath).toContain("export { User, isUser };");
    expect(subpath).not.toContain('from "./index.js"');
    expect(manifest.modules).toEqual([
      {
        name: "user",
        source: "./jit/user.jit.ts",
        import: "./user.js",
        exports: ["User", "isUser"],
      },
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

  it("should use the package namespace for node_modules subpath imports", () => {
    const User = JIT.object({ id: JIT.number() });
    const packageDir = join(outDir, "node_modules", "@acme", "generated");
    const schemaFile = join(outDir, "src", "user.jit.ts");

    AOT.generate({
      schemas: {
        User: JIT.compile(User, { is: JIT.is(User) }),
      },
      sources: new Map([["User", schemaFile]]),
      outDir: packageDir,
      emit: { subpathModules: true, manifest: true },
    });

    const manifest = JSON.parse(readFileSync(join(packageDir, "manifest.json"), "utf8")) as {
      packageName: string;
      modules: readonly { readonly import: string }[];
    };
    const packageJson = JSON.parse(readFileSync(join(packageDir, "package.json"), "utf8")) as {
      name: string;
      exports: Record<string, unknown>;
    };

    expect(manifest.packageName).toBe("@acme/generated");
    expect(manifest.modules[0]?.import).toBe("@acme/generated/user");
    expect(packageJson.name).toBe("@acme/generated");
    expect(packageJson.exports).toHaveProperty("./user");
  });

  it("should compile subpaths as physically isolated modules", () => {
    const User = JIT.object({ id: JIT.number() });
    const Order = JIT.object({ sku: JIT.string() });

    AOT.generate({
      schemas: {},
      functions: {
        User_is: JIT.is(User),
        Order_stringify: JIT.json.stringify(Order),
      },
      sources: new Map([
        ["User_is", join(outDir, "user.jit.ts")],
        ["Order_stringify", join(outDir, "order.jit.ts")],
      ]),
      outDir,
      emit: { subpathModules: true },
    });

    const user = readFileSync(join(outDir, "user.js"), "utf8");
    const order = readFileSync(join(outDir, "order.js"), "utf8");

    expect(user).toContain("User_is");
    expect(user).not.toContain("Order_stringify");
    expect(user).not.toContain('from "./index.js"');
    expect(order).toContain("Order_stringify");
    expect(order).not.toContain("User_is");
  });
});

describe("JIT AOT self-contained types", () => {
  let outDir: string;

  beforeEach(() => {
    outDir = mkdtempSync(join(tmpdir(), "jit-aot-infer-"));
  });

  afterEach(() => {
    rmSync(outDir, { recursive: true, force: true });
  });

  it("should embed structural types without depending on the declaration file", () => {
    const User = JIT.object({ id: JIT.number(), name: JIT.string() });
    const isUser = JIT.is(User);
    const generated = join(outDir, "generated");
    const schemaFile = join(outDir, "src", "user.jit.ts");

    AOT.generate({
      schemas: { User: JIT.compile(User, { is: isUser }) },
      sources: new Map([["User", schemaFile]]),
      outDir: generated,
      format: "typescript",
    });

    const source = readFileSync(join(generated, "index.ts"), "utf8");

    expect(source).toContain("export type User = { id: number; name: string };");
    expect(source).toContain("export type UserStrict<TValue> = TValue;");
    expect(source).not.toContain("../src/user.jit.js");
    expect(source).not.toContain("@jit-compiler/jit");
  });

  it("should typecheck real imports from generated files after generation", async () => {
    const UserSchema = JIT.object({ id: JIT.number(), name: JIT.string() });
    const isUser = JIT.is(UserSchema);
    const parseUser = JIT.parse(UserSchema);
    const srcDir = join(outDir, "src");
    const generatedDir = join(outDir, "node_modules", "@jit", "generated");
    const schemaFile = join(srcDir, "user.jit.ts");
    const consumerFile = join(outDir, "consumer.ts");
    const repoRoot = fileURLToPath(new URL("../../../../../", import.meta.url));
    const tscBin = join(repoRoot, "node_modules", "typescript", "bin", "tsc");

    mkdirSync(srcDir, { recursive: true });
    writeFileSync(
      schemaFile,
      [
        'import { JIT } from "@jit-compiler/jit/define";',
        "",
        "export const UserSchema = JIT.object({ id: JIT.number(), name: JIT.string() });",
        "export const isUser = JIT.validate.is(UserSchema);",
        "export const parseUser = JIT.validate.parse(UserSchema);",
        "export const User = JIT.compile(UserSchema, { is: isUser, parse: parseUser });",
        "",
      ].join("\n")
    );

    AOT.generate({
      schemas: {
        User: JIT.compile(UserSchema, {
          is: isUser,
          parse: parseUser,
        }),
      },
      functions: { isUser },
      sources: new Map([
        ["User", schemaFile],
        ["isUser", schemaFile],
      ]),
      outDir: generatedDir,
      format: "typescript",
    });

    writeFileSync(
      consumerFile,
      [
        'import { User, isUser, type User as UserValue } from "@jit/generated";',
        "",
        'const ok: UserValue = { id: 1, name: "Ada" };',
        "const parsed = User.parse(ok);",
        "const same: UserValue = parsed;",
        "const guard: (value: unknown) => value is UserValue = User.is;",
        "const standaloneGuard: (value: unknown) => value is UserValue = isUser;",
        "guard(ok);",
        "standaloneGuard(ok);",
        "same.id.toFixed();",
        "// @ts-expect-error generated User type rejects invalid id type",
        'const bad: UserValue = { id: "1", name: "Ada" };',
        "// @ts-expect-error parse result keeps the generated User shape",
        "const badName: number = parsed.name;",
        "",
      ].join("\n")
    );
    writeFileSync(
      join(outDir, "tsconfig.json"),
      JSON.stringify(
        {
          compilerOptions: {
            target: "ES2022",
            lib: ["ESNext"],
            module: "NodeNext",
            moduleResolution: "NodeNext",
            strict: true,
            noEmit: true,
            skipLibCheck: true,
            types: ["node"],
            typeRoots: [join(repoRoot, "node_modules/@types")],
            ignoreDeprecations: "6.0",
            baseUrl: ".",
            paths: {
              "@jit-compiler/jit": [join(repoRoot, "packages/jit/src/index.ts")],
              "@jit-compiler/jit/define": [join(repoRoot, "packages/jit/src/define.ts")],
            },
          },
          include: ["consumer.ts", "src/**/*.ts"],
        },
        null,
        2
      )
    );

    const generated = (await import(pathToFileURL(join(generatedDir, "index.ts")).href)) as {
      User: {
        is: (value: unknown) => boolean;
        parse: (value: unknown) => unknown;
      };
      isUser: (value: unknown) => boolean;
    };

    expect(generated.User.is({ id: 1, name: "Ada" })).toBe(true);
    expect(generated.User.parse({ id: 1, name: "Ada" })).toEqual({
      id: 1,
      name: "Ada",
    });
    expect(generated.isUser({ id: "x", name: "Ada" })).toBe(false);
    try {
      execFileSync(process.execPath, [tscBin, "--project", join(outDir, "tsconfig.json"), "--pretty", "false"], {
        cwd: outDir,
        stdio: "pipe",
      });
    } catch (error) {
      const failed = error as {
        readonly stdout?: Buffer;
        readonly stderr?: Buffer;
      };

      throw new Error(
        `generated import typecheck failed\n${failed.stdout?.toString() ?? ""}${failed.stderr?.toString() ?? ""}`
      );
    }
  }, 15_000);

  it("should fall back to structural types for programmatic schemas without sources", () => {
    const User = JIT.object({ id: JIT.number() });
    const isUser = JIT.is(User);

    AOT.generate({
      schemas: { User: JIT.compile(User, { is: isUser }) },
      outDir,
      format: "typescript",
    });

    const source = readFileSync(join(outDir, "index.ts"), "utf8");

    expect(source).toContain("export type User = { id: number };");
    expect(source).toContain("export type UserStrict<TValue> = TValue;");
  });

  it("should expose JIT.Typeof for builders and schemas", () => {
    const User = JIT.object({
      id: JIT.number(),
      tags: JIT.array(JIT.string()),
    });

    expectTypeOf<JIT.Typeof<typeof User>>().toEqualTypeOf<{
      id: number;
      tags: string[];
    }>();
    expectTypeOf<JIT.Typeof<typeof User.schema>>().toEqualTypeOf<JIT.Typeof<typeof User>>();
    // @ts-expect-error Infer was removed in favor of the single Typeof helper.
    expectTypeOf<JIT.Infer<typeof User>>();
    // @ts-expect-error The lowercase compatibility alias was removed too.
    expectTypeOf<JIT.infer<typeof User>>();
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
      "const isUser = JIT.is(User);",
      "export const User_is = isUser;",
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
      entries: ["src/models"],
      patterns: ["**/*.jit.ts"],
      output: {
        directory: "node_modules/@acme/models",
        packageName: "@acme/models",
        clean: true,
      },
    });

    expect(config.output.packageName).toBe("@acme/models");
    expect(config.patterns).toEqual(["**/*.jit.ts"]);
  });
});
