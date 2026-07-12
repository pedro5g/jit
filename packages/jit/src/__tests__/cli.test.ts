import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { createConfigSource, main } from "../cli.js";

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

  it("should initialize a typed AOT config in the project root", async () => {
    const { runtime, stdout, stderr } = createRuntime();
    const code = await main(["init"], runtime);
    const configPath = join(projectDir, "jit.config.ts");
    const source = readFileSync(configPath, "utf8");

    expect(code).toBe(0);
    expect(stdout.join("")).toContain("created");
    expect(stderr.join("")).toBe("");
    expect(source).toContain('import { AOT } from "@pedro5g/jit";');
    expect(source).toContain('entries: ["./jit/**/*.jit.ts"]');
    expect(source).toContain('directory: "generated/jit"');
    expect(source).toContain('importSpecifier: "#jit"');
    expect(source).toContain('patterns: ["**/*.jit.ts"]');
    expect(source).toContain("subpathModules: true");
    expect(source).toContain("manifest: true");
    expect(source).toContain("plans: true");
    expect(existsSync(join(projectDir, "jit", "user.jit.ts"))).toBe(true);
    expect(source).not.toContain("operations:");
    expect(source).not.toContain("exportMode:");
    expect(source).toContain("Use false when generating inside an existing source directory");
  });

  it("should refuse to overwrite an existing config unless forced", async () => {
    const { runtime, stderr } = createRuntime();

    writeFileSync(join(projectDir, "jit.config.ts"), "export default {};\n");

    expect(await main(["init"], runtime)).toBe(1);
    expect(stderr.join("")).toContain("--force");

    expect(
      await main(["init", "--force", "--format", "mjs", "--schemas", "models/**/*.ts", "--pattern", "**/*.ts"], runtime)
    ).toBe(0);
    expect(existsSync(join(projectDir, "jit.config.mjs"))).toBe(true);
    expect(readFileSync(join(projectDir, "jit.config.mjs"), "utf8")).toContain('entries: ["models/**/*.ts"]');
    expect(readFileSync(join(projectDir, "jit.config.mjs"), "utf8")).toContain('patterns: ["**/*.ts"]');
  });

  it("should generate standalone AOT functions from explicit exports", async () => {
    const { runtime, stdout, stderr } = createRuntime();

    mkdirSync(join(projectDir, "src"), { recursive: true });
    mkdirSync(join(projectDir, "node_modules", "@pedro5g"), { recursive: true });
    symlinkSync(join(process.cwd(), "packages", "jit"), join(projectDir, "node_modules", "@pedro5g", "jit"), "dir");
    writeFileSync(
      join(projectDir, "src", "user.jit.ts"),
      [
        `import { JIT } from ${JSON.stringify(pathToFileURL(join(process.cwd(), "packages", "jit", "src", "index.ts")).href)};`,
        "",
        "export const User = JIT.object({",
        "  id: JIT.number(),",
        "  name: JIT.string(),",
        "});",
        "const selected = JIT.validator(User).get('is');",
        "export const User_is = selected.is;",
        "",
      ].join("\n")
    );
    writeFileSync(
      join(projectDir, "jit.config.mjs"),
      createConfigSource({
        format: "mjs",
        force: true,
        entries: ["src"],
        outDir: "generated",
        packageName: "@acme/generated",
        patterns: ["**/*.jit.ts"],
      })
    );

    const code = await main(["generate"], runtime);
    const source = readFileSync(join(projectDir, "generated", "index.mjs"), "utf8");
    const types = readFileSync(join(projectDir, "generated", "index.d.ts"), "utf8");

    expect(code).toBe(0);
    expect(stderr.join("")).toBe("");
    expect(stdout.join("")).toContain("using");
    expect(source).toContain("const User_is");
    expect(source).not.toContain("const User_parse");
    expect(source).not.toContain("const User = /*#__PURE__*/ Object.freeze({");
    expect(types).toContain('export declare const User_is: typeof import("../src/user.jit.js").User_is;');
    expect(types).not.toContain("export declare const User: {");
    expect(existsSync(join(projectDir, "generated", "user.mjs"))).toBe(true);
    expect(existsSync(join(projectDir, "generated", "manifest.json"))).toBe(true);
    expect(existsSync(join(projectDir, "generated", "plans", "user.json"))).toBe(true);
  });

  it("should diagnose and explain AOT declaration discovery", async () => {
    const { runtime, stdout, stderr } = createRuntime();

    mkdirSync(join(projectDir, "src"), { recursive: true });
    mkdirSync(join(projectDir, "node_modules", "@pedro5g"), { recursive: true });
    symlinkSync(join(process.cwd(), "packages", "jit"), join(projectDir, "node_modules", "@pedro5g", "jit"), "dir");
    writeFileSync(
      join(projectDir, "src", "user.jit.ts"),
      [
        `import { JIT } from ${JSON.stringify(pathToFileURL(join(process.cwd(), "packages", "jit", "src", "index.ts")).href)};`,
        "",
        "export const User = JIT.object({",
        "  id: JIT.number(),",
        "  name: JIT.string(),",
        "});",
        "export const User_is = JIT.validate(User).is().compile();",
        "export const UserModel = JIT.compile(User, {",
        "  is: User_is,",
        "  diff: JIT.diff(User).compile(),",
        "});",
        "",
      ].join("\n")
    );
    writeFileSync(
      join(projectDir, "jit.config.mjs"),
      createConfigSource({
        format: "mjs",
        force: true,
        entries: ["src"],
        outDir: "generated",
        packageName: "@acme/generated",
        patterns: ["**/*.jit.ts"],
      })
    );

    expect(await main(["doctor"], runtime)).toBe(0);
    expect(stdout.join("")).toContain("jit doctor");
    expect(stdout.join("")).toContain("files: 1");

    stdout.length = 0;
    stderr.length = 0;

    expect(await main(["explain"], runtime)).toBe(0);
    expect(stderr.join("")).toBe("");
    expect(stdout.join("")).toContain("jit explain");
    expect(stdout.join("")).toContain("grouped objects: 1");
    expect(stdout.join("")).toContain("UserModel: is, diff");
    expect(stdout.join("")).toContain("standalone functions: 1");
    expect(stdout.join("")).toContain("User_is: validator:is");

    stdout.length = 0;
    stderr.length = 0;

    expect(await main(["list"], runtime)).toBe(0);
    expect(stderr.join("")).toBe("");
    expect(stdout.join("")).toContain("jit list");
    expect(stdout.join("")).toContain("UserModel: is, diff");

    stdout.length = 0;
    stderr.length = 0;

    expect(await main(["inspect", "User_is", "--stage", "plan"], runtime)).toBe(0);
    expect(stderr.join("")).toBe("");
    expect(stdout.join("")).toContain("jit inspect User_is");
    expect(stdout.join("")).toContain('"operations": [');
    expect(stdout.join("")).toContain('"is"');

    stdout.length = 0;
    stderr.length = 0;

    expect(await main(["generate"], runtime)).toBe(0);
    expect(existsSync(join(projectDir, "generated", "index.mjs"))).toBe(true);
    expect(await main(["clean"], runtime)).toBe(0);
    expect(stdout.join("")).toContain("removed");
    expect(existsSync(join(projectDir, "generated"))).toBe(false);
  });

  it("should warn when declaration files contain no buildable exports", async () => {
    const { runtime, stderr } = createRuntime();

    mkdirSync(join(projectDir, "src"), { recursive: true });
    writeFileSync(join(projectDir, "src", "user.jit.ts"), "export const User = { type: 'object', def: {} };\n");

    expect(await main(["generate", "src/user.jit.ts"], runtime)).toBe(1);
    expect(stderr.join("")).toContain("No AOT functions found");
  });
});
