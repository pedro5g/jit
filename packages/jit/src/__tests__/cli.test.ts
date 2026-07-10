import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
    expect(source).toContain('import { AOT } from "jit";');
    expect(source).toContain('schemas: ["src"]');
    expect(source).toContain('operations: ["is", "parse", "safeParse"]');
    expect(source).toContain('exportMode: "auto"');
  });

  it("should refuse to overwrite an existing config unless forced", async () => {
    const { runtime, stderr } = createRuntime();

    writeFileSync(join(projectDir, "jit.config.ts"), "export default {};\n");

    expect(await main(["init"], runtime)).toBe(1);
    expect(stderr.join("")).toContain("--force");

    expect(await main(["init", "--force", "--format", "mjs", "--schemas", "models", "--ops", "is"], runtime)).toBe(0);
    expect(existsSync(join(projectDir, "jit.config.mjs"))).toBe(true);
    expect(readFileSync(join(projectDir, "jit.config.mjs"), "utf8")).toContain('operations: ["is"]');
  });

  it("should generate minimal flat AOT output from config", async () => {
    const { runtime, stdout, stderr } = createRuntime();

    mkdirSync(join(projectDir, "src"), { recursive: true });
    mkdirSync(join(projectDir, "node_modules"), { recursive: true });
    symlinkSync(join(process.cwd(), "packages", "jit"), join(projectDir, "node_modules", "jit"), "dir");
    writeFileSync(
      join(projectDir, "src", "user.jit.ts"),
      [
        'import { JIT } from "jit";',
        "",
        "export const User = JIT.object({",
        "  id: JIT.number(),",
        "  name: JIT.string(),",
        "});",
        "",
      ].join("\n")
    );
    writeFileSync(
      join(projectDir, "jit.config.mjs"),
      createConfigSource({
        format: "mjs",
        force: true,
        schemas: ["src"],
        outDir: "generated",
        packageName: "@acme/generated",
        operations: ["is"],
        exportMode: "flat",
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
    expect(types).toContain("export declare const User_is");
    expect(types).not.toContain("export declare const User: {");
  });
});
