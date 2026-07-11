import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cleanBuildArtifacts } from "../../../../scripts/clean-build-artifacts.js";

describe("build artifact cleanup", () => {
  let projectDir: string;

  beforeEach(() => {
    projectDir = mkdtempSync(join(tmpdir(), "jit-clean-"));
  });

  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true });
  });

  it("should remove generated package artifacts without touching source files", () => {
    mkdirSync(join(projectDir, "aot"), { recursive: true });
    mkdirSync(join(projectDir, "src"), { recursive: true });
    writeFileSync(join(projectDir, "index.js"), "");
    writeFileSync(join(projectDir, "index.d.ts"), "");
    writeFileSync(join(projectDir, "aot", "generate.cjs"), "");
    writeFileSync(join(projectDir, "src", "keep.js"), "");
    writeFileSync(join(projectDir, "README.md"), "");

    const removed = cleanBuildArtifacts({ rootDir: projectDir }).map((path) => path.slice(projectDir.length + 1));

    expect(removed.sort()).toEqual(["aot/generate.cjs", "index.d.ts", "index.js"]);
    expect(existsSync(join(projectDir, "index.js"))).toBe(false);
    expect(existsSync(join(projectDir, "aot", "generate.cjs"))).toBe(false);
    expect(existsSync(join(projectDir, "src", "keep.js"))).toBe(true);
    expect(existsSync(join(projectDir, "README.md"))).toBe(true);
  });
});
