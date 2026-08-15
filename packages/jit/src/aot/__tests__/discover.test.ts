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

  it("should emit one ready-to-run JavaScript module", async () => {
    const User = JIT.object({ id: JIT.number(), name: JIT.string() });
    const result = AOT.generate({ artifacts: { User_is: JIT.validate.is(User) }, outDir });

    expect(result.files.map((file) => file.split("/").pop())).toEqual(["index.js"]);

    const generated = (await import(pathToFileURL(join(outDir, "index.js")).href)) as Record<string, unknown>;
    const flat = generated.User_is as (value: unknown) => boolean;

    expect(flat({ id: 1, name: "Ada" })).toBe(true);
    expect(flat({ id: "x" })).toBe(false);
    expect(generated.User).toBeUndefined();
  });

  it("should expose flat per-operation exports by default", () => {
    const User = JIT.object({ id: JIT.number() });
    const isUser = JIT.validate.is(User);

    AOT.generate({ groups: {}, artifacts: { User_is: isUser }, outDir, format: "ts" });

    const source = readFileSync(join(outDir, "index.ts"), "utf8");

    expect(source).toMatch(/export \{ .*User_is.* \};/);
    expect(source).not.toMatch(/export \{[^}]*, User \};/);
    expect(source).not.toContain("const User = /*#__PURE__*/ Object.freeze({");
    expect(source).toContain("const User_is: (value: unknown) => value is { id: number } =");
    expect(source).not.toContain("const User: {");
  });

  it("should expose an artifact object as one frozen export", () => {
    const User = JIT.object({ id: JIT.number() });
    const isUser = JIT.validate.is(User);

    AOT.generate({
      groups: { User: { is: isUser } },
      schemas: { User },
      outDir,
      format: "ts",
    });

    const source = readFileSync(join(outDir, "index.ts"), "utf8");

    expect(source).toContain("} = /*#__PURE__*/ Object.freeze({");
    expect(source).toMatch(/export \{ User \};/);
    expect(source).not.toMatch(/export \{[^}]*User_is/);
    expect(source).not.toContain("const User_is:");
    expect(source).toContain("readonly is: (value: unknown) => value is User;");
  });

  it("should emit one module per declaration file plus a barrel", () => {
    const User = JIT.object({ id: JIT.number() });
    const Order = JIT.object({ sku: JIT.string() });
    const userFile = join(outDir, "user.jit.ts");
    const orderFile = join(outDir, "order.jit.ts");

    const result = AOT.generate({
      artifacts: {
        User_is: JIT.validate.is(User),
        Order_stringify: JIT.json.stringify(Order),
      },
      schemas: { User, Order },
      sources: new Map([
        ["User_is", userFile],
        ["User", userFile],
        ["Order_stringify", orderFile],
        ["Order", orderFile],
      ]),
      outDir,
      format: "ts",
      perFile: true,
    });

    expect(result.files.map((file) => file.split("/").pop()).sort()).toEqual(["index.ts", "order.ts", "user.ts"]);

    const user = readFileSync(join(outDir, "user.ts"), "utf8");
    const order = readFileSync(join(outDir, "order.ts"), "utf8");
    const barrel = readFileSync(join(outDir, "index.ts"), "utf8");

    // Each module is physically isolated: no cross-imports, no shared runtime.
    expect(user).toContain("User_is");
    expect(user).not.toContain("Order_stringify");
    expect(user).not.toContain('from "./index.js"');
    expect(order).toContain("Order_stringify");
    expect(order).not.toContain("User_is");
    expect(barrel).toContain('export { User_is } from "./user.js";');
    expect(barrel).toContain('export type { User } from "./user.js";');
    expect(barrel).toContain('export { Order_stringify } from "./order.js";');
  });

  it("should keep everything in one index module by default", () => {
    const User = JIT.object({ id: JIT.number() });
    const Order = JIT.object({ sku: JIT.string() });

    const result = AOT.generate({
      artifacts: {
        User_is: JIT.validate.is(User),
        Order_stringify: JIT.json.stringify(Order),
      },
      sources: new Map([
        ["User_is", join(outDir, "user.jit.ts")],
        ["Order_stringify", join(outDir, "order.jit.ts")],
      ]),
      outDir,
    });

    expect(result.files.map((file) => file.split("/").pop())).toEqual(["index.js"]);
    expect(readFileSync(join(outDir, "index.js"), "utf8")).toContain("export { User_is, Order_stringify };");
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
    const isUser = JIT.validate.is(User);
    const generated = join(outDir, "generated");
    const schemaFile = join(outDir, "src", "user.jit.ts");

    AOT.generate({
      groups: { UserOps: { is: isUser } },
      schemas: { User },
      sources: new Map([["UserOps", schemaFile]]),
      outDir: generated,
      format: "ts",
    });

    const source = readFileSync(join(generated, "index.ts"), "utf8");

    expect(source).toContain("export type User = { id: number; name: string };");
    expect(source).not.toContain("../src/user.jit.js");
    expect(source).not.toContain("@jit-compiler/jit");
  });

  it("should typecheck real imports from generated files after generation", async () => {
    const UserSchema = JIT.object({ id: JIT.number(), name: JIT.string() });
    const isUser = JIT.validate.is(UserSchema);
    const parseUser = JIT.validate.parse(UserSchema);
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
        "export const User = { is: isUser, parse: parseUser };",
        "",
      ].join("\n")
    );

    AOT.generate({
      groups: {
        User: {
          is: isUser,
          parse: parseUser,
        },
      },
      artifacts: { isUser },
      schemas: { User: UserSchema },
      sources: new Map([
        ["User", schemaFile],
        ["isUser", schemaFile],
      ]),
      outDir: generatedDir,
      format: "ts",
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

  it("should name a generated type after the schema that declared it", () => {
    const User = JIT.object({ id: JIT.number() });
    const Team = JIT.object({ owner: User, members: JIT.array(User) });

    AOT.generate({
      artifacts: { isTeam: JIT.validate.is(Team) },
      schemas: { User, Team },
      outDir,
      format: "ts",
    });

    const source = readFileSync(join(outDir, "index.ts"), "utf8");

    expect(source).toContain("export type User = { id: number };");
    // A nested schema that has its own name is referenced, never re-inlined.
    expect(source).toContain("export type Team = { owner: User; members: User[] };");
    expect(source).toContain("const isTeam: (value: unknown) => value is Team =");
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

  it("should classify declarations by what they are, exported or not", async () => {
    const schemaModule = [
      `import { JIT } from ${JSON.stringify(pathToFileURL(join(process.cwd(), "packages", "jit", "src", "index.ts")).href)};`,
      "const User = JIT.object({ id: JIT.number() });",
      "const isUser = JIT.validate.is(User);",
      "export const User_is = isUser;",
      "const UserMethods = { stringify: JIT.json.stringify(User) };",
      "export const notASchema = 42;",
      "",
    ].join("\n");

    writeFileSync(join(projectDir, "user.jit.ts"), schemaModule);

    const collected = await AOT.collectDeclarations([join(projectDir, "user.jit.ts")]);

    // A private schema still names its generated type.
    expect(Object.keys(collected.schemas)).toEqual(["User"]);
    // A private object of artifacts is still a declaration.
    expect(Object.keys(collected.groups)).toEqual(["UserMethods"]);
    // `isUser` only exists to back the exported alias, which wins.
    expect(Object.keys(collected.artifacts)).toEqual(["User_is"]);
    expect([...collected.exported]).toEqual(["User_is"]);

    writeFileSync(join(projectDir, "dup.jit.ts"), schemaModule);

    await expect(
      AOT.collectDeclarations([join(projectDir, "user.jit.ts"), join(projectDir, "dup.jit.ts")])
    ).rejects.toThrow(/defined in both/);
  });

  it("should find jit.config files and type them via defineConfig", () => {
    writeFileSync(join(projectDir, "jit.config.mjs"), "export default {};\n");

    expect(AOT.findConfigFile(projectDir)).toBe(join(projectDir, "jit.config.mjs"));
    expect(AOT.findConfigFile(join(projectDir, "src"))).toBeUndefined();

    const config = AOT.defineConfig({
      entries: ["src/models"],
      patterns: ["**/*.jit.ts"],
      output: {
        directory: "src/generated/jit",
        format: "ts",
        perFile: true,
      },
    });

    expect(config.output.directory).toBe("src/generated/jit");
    expect(config.output.format).toBe("ts");
    expect(config.patterns).toEqual(["**/*.jit.ts"]);
  });
});
