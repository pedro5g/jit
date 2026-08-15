import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { createConfigSource, main } from "../cli.js";

const DEFINE_IMPORT = JSON.stringify(pathToFileURL(join(process.cwd(), "packages", "jit", "src", "index.ts")).href);

describe("jit CLI", () => {
  let projectDir: string;

  beforeEach(() => {
    projectDir = mkdtempSync(join(tmpdir(), "jit-cli-"));
  });

  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true });
  });

  function createRuntime() {
    const stdout: string[] = [];
    const stderr: string[] = [];

    return {
      runtime: {
        cwd: projectDir,
        stdout: (text: string) => stdout.push(text),
        stderr: (text: string) => stderr.push(text),
      },
      stdout,
      stderr,
    };
  }

  function writeDeclaration(file: string, body: readonly string[]): void {
    mkdirSync(join(projectDir, "src"), { recursive: true });
    writeFileSync(join(projectDir, "src", file), [`import { JIT } from ${DEFINE_IMPORT};`, "", ...body, ""].join("\n"));
  }

  function writeConfig(options: { readonly perFile?: boolean } = {}): void {
    writeFileSync(
      join(projectDir, "jit.config.mjs"),
      `export default ${JSON.stringify(
        { entries: ["src"], output: { directory: "generated", format: "ts", perFile: options.perFile === true } },
        null,
        2
      )};\n`
    );
  }

  it("should initialize a typed AOT config in the project root", async () => {
    const { runtime, stdout, stderr } = createRuntime();

    writeFileSync(join(projectDir, "tsconfig.json"), "{}\n");

    const code = await main(["init"], runtime);
    const source = readFileSync(join(projectDir, "jit.config.ts"), "utf8");

    expect(code).toBe(0);
    expect(stdout.join("")).toContain("created");
    expect(stderr.join("")).toBe("");
    expect(source).toContain('import { AOT } from "@jit-compiler/jit";');
    expect(source).toContain('entries: ["./jit/**/*.jit.ts"]');
    expect(source).toContain('directory: "generated"');
    expect(source).toContain('format: "ts"');
    expect(existsSync(join(projectDir, "jit", "user.jit.ts"))).toBe(true);
  });

  it("should initialize plain JavaScript output when the project has no tsconfig", async () => {
    const { runtime } = createRuntime();
    const code = await main(["init"], runtime);
    const source = readFileSync(join(projectDir, "jit.config.js"), "utf8");

    expect(code).toBe(0);
    expect(source).toContain('format: "js"');
    expect(source).toContain('entries: ["./jit/**/*.jit.js"]');
    expect(source).not.toContain("import { AOT }");
    expect(existsSync(join(projectDir, "jit", "user.jit.js"))).toBe(true);
  });

  it("should keep the config to declaration entries and one output target", () => {
    const source = createConfigSource({
      format: "ts",
      force: true,
      entries: ["src"],
      outDir: "generated",
      perFile: false,
    });

    for (const removed of ["packageName", "clean", "subpathModules", "manifest", "plans", "patterns"]) {
      expect(source, `config must not carry ${removed}`).not.toContain(removed);
    }
  });

  it("should generate one index module from declared artifacts", async () => {
    const { runtime, stdout, stderr } = createRuntime();

    writeDeclaration("user.jit.ts", [
      "const User = JIT.object({",
      "  id: JIT.number(),",
      "  name: JIT.string(),",
      "});",
      "",
      "export const isUser = JIT.validate.is(User);",
    ]);
    writeConfig();

    const code = await main(["generate"], runtime);
    const source = readFileSync(join(projectDir, "generated", "index.ts"), "utf8");

    expect(code).toBe(0);
    expect(stderr.join("")).toBe("");
    expect(stdout.join("")).toContain("using");
    // The schema is private in the declaration, but it still names the type.
    expect(source).toContain("export type User = { id: number; name: string };");
    expect(source).toContain("const isUser: (value: unknown) => value is User =");
    expect(source).toContain("export { isUser };");
    expect(source).not.toContain("import");
    expect(existsSync(join(projectDir, "generated", "index.d.ts"))).toBe(false);
    expect(existsSync(join(projectDir, "generated", "manifest.json"))).toBe(false);
    expect(existsSync(join(projectDir, "generated", "plans"))).toBe(false);
  });

  it("should generate an object of artifacts as one frozen object", async () => {
    const { runtime } = createRuntime();

    writeDeclaration("user.jit.ts", [
      "const User = JIT.object({ id: JIT.number(), name: JIT.string() });",
      "",
      "export const UserMethods = {",
      "  is: JIT.validate.is(User),",
      "  toJson: JIT.json.stringify(User),",
      "  equal: JIT.compare.equal(User),",
      "};",
    ]);
    writeConfig();

    const code = await main(["generate"], runtime);
    const source = readFileSync(join(projectDir, "generated", "index.ts"), "utf8");

    expect(code).toBe(0);
    expect(source).toContain("readonly is: (value: unknown) => value is User;");
    expect(source).toContain("readonly toJson: (value: User) => string;");
    expect(source).toContain("readonly equal: (left: User, right: User) => boolean;");
    expect(source).toContain("Object.freeze({");
    expect(source).toContain("export { UserMethods };");
  });

  it("should emit one module per declaration file plus a barrel when asked", async () => {
    const { runtime } = createRuntime();

    writeDeclaration("user.jit.ts", [
      "const User = JIT.object({ id: JIT.number() });",
      "export const isUser = JIT.validate.is(User);",
    ]);
    writeDeclaration("post.jit.ts", [
      "const Post = JIT.object({ slug: JIT.string() });",
      "export const isPost = JIT.validate.is(Post);",
    ]);
    writeConfig({ perFile: true });

    const code = await main(["generate"], runtime);
    const barrel = readFileSync(join(projectDir, "generated", "index.ts"), "utf8");

    expect(code).toBe(0);
    expect(existsSync(join(projectDir, "generated", "user.ts"))).toBe(true);
    expect(existsSync(join(projectDir, "generated", "post.ts"))).toBe(true);
    expect(barrel).toContain('export { isUser } from "./user.js";');
    expect(barrel).toContain('export type { User } from "./user.js";');
    expect(barrel).toContain('export { isPost } from "./post.js";');
  });

  it("should remove output left by a previous generation", async () => {
    const { runtime } = createRuntime();

    writeDeclaration("user.jit.ts", [
      "const User = JIT.object({ id: JIT.number() });",
      "export const isUser = JIT.validate.is(User);",
    ]);
    writeConfig({ perFile: true });
    await main(["generate"], runtime);

    writeConfig({ perFile: false });
    const code = await main(["generate"], runtime);

    expect(code).toBe(0);
    expect(existsSync(join(projectDir, "generated", "index.ts"))).toBe(true);
    expect(existsSync(join(projectDir, "generated", "user.ts"))).toBe(false);
  });

  it("should never delete files it did not generate", async () => {
    const { runtime } = createRuntime();

    writeDeclaration("user.jit.ts", [
      "const User = JIT.object({ id: JIT.number() });",
      "export const isUser = JIT.validate.is(User);",
    ]);
    writeConfig();
    mkdirSync(join(projectDir, "generated"), { recursive: true });
    writeFileSync(join(projectDir, "generated", "handwritten.ts"), "export const keep = 1;\n");

    await main(["generate"], runtime);

    expect(existsSync(join(projectDir, "generated", "handwritten.ts"))).toBe(true);
  });

  it("should report discovery and declarations without generating", async () => {
    const { runtime, stdout } = createRuntime();

    writeDeclaration("user.jit.ts", [
      "const User = JIT.object({ id: JIT.number() });",
      "export const isUser = JIT.validate.is(User);",
      "export const UserMethods = { toJson: JIT.json.stringify(User) };",
    ]);
    writeConfig();

    expect(await main(["doctor"], runtime)).toBe(0);
    expect(await main(["list"], runtime)).toBe(0);

    const output = stdout.join("");

    expect(output).toContain("format: ts");
    expect(output).toContain("layout: single index module");
    expect(output).toContain("type User");
    expect(output).toContain("isUser:");
    expect(output).toContain("UserMethods:");
    expect(existsSync(join(projectDir, "generated"))).toBe(false);
  });

  it("should print the generated source for one declaration", async () => {
    const { runtime, stdout } = createRuntime();

    writeDeclaration("user.jit.ts", [
      "const User = JIT.object({ id: JIT.number() });",
      "export const isUser = JIT.validate.is(User);",
    ]);
    writeConfig();

    const code = await main(["inspect", "isUser", "--stage", "source"], runtime);

    expect(code).toBe(0);
    expect(stdout.join("")).toContain("const isUser:");
  });

  it("should fail when a declaration file holds no artifacts", async () => {
    const { runtime, stderr } = createRuntime();

    writeDeclaration("user.jit.ts", ["export const User = JIT.object({ id: JIT.number() });"]);
    writeConfig();

    const code = await main(["generate"], runtime);

    expect(code).toBe(1);
    expect(stderr.join("")).toContain("No AOT artifacts found");
  });

  it("should reject unknown output formats", async () => {
    const { runtime, stderr } = createRuntime();

    writeDeclaration("user.jit.ts", ["export const isUser = JIT.validate.is(JIT.object({ id: JIT.number() }));"]);
    writeConfig();

    const code = await main(["generate", "--format", "mjs"], runtime);

    expect(code).toBe(1);
    expect(stderr.join("")).toContain('expected "ts" or "js"');
  });

  it("should remove the generated directory on clean", async () => {
    const { runtime } = createRuntime();

    writeDeclaration("user.jit.ts", [
      "const User = JIT.object({ id: JIT.number() });",
      "export const isUser = JIT.validate.is(User);",
    ]);
    writeConfig();
    await main(["generate"], runtime);

    expect(await main(["clean"], runtime)).toBe(0);
    expect(existsSync(join(projectDir, "generated"))).toBe(false);
  });
});
