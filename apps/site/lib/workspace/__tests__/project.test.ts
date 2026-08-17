import { describe, expect, it } from "vitest";
import {
  buildTree,
  compilationOrder,
  createDirectory,
  createFile,
  deleteEntry,
  directoriesOf,
  fileProblem,
  importedPaths,
  projectOrder,
  renameEntry,
  type WorkspaceProject,
  writeFile,
} from "../project";

const project = (files: [string, string][], directories: string[] = []): WorkspaceProject => ({
  files: files.map(([path, source]) => ({ path, source })),
  directories,
  activePath: files[0]?.[0] ?? "",
});

describe("path rules", () => {
  it("refuses what the artifact protocol would refuse", () => {
    expect(fileProblem("../escape.ts")).toMatch(/navigate/);
    expect(fileProblem("/absolute.ts")).toMatch(/relative/);
    expect(fileProblem("windows\\path.ts")).toMatch(/separate/);
    expect(fileProblem("schemas//user.ts")).toMatch(/empty segment/);
    expect(fileProblem("notes.md")).toMatch(/\.ts/);
    expect(fileProblem("schemas/user.ts")).toBeNull();
  });
});

describe("the tree", () => {
  it("implies a directory from the files inside it and keeps the empty ones", () => {
    const workspace = project([["schemas/user.ts", ""]], ["dto"]);

    expect(directoriesOf(workspace)).toEqual(["dto", "schemas"]);
  });

  it("puts directories before files and sorts both", () => {
    const workspace = project(
      [
        ["index.ts", ""],
        ["schemas/user.ts", ""],
        ["account.ts", ""],
      ],
      ["dto"]
    );

    expect(buildTree(workspace).map((node) => node.path)).toEqual(["dto", "schemas", "account.ts", "index.ts"]);
  });
});

describe("editing the tree", () => {
  it("moves everything under a directory when the directory is renamed", () => {
    const workspace = project([
      ["schemas/user.ts", "export const User = 1;"],
      ["schemas/nested/account.ts", ""],
      ["index.ts", ""],
    ]);
    const { project: renamed, problem } = renameEntry(workspace, "schemas", "contracts");

    expect(problem).toBeUndefined();
    expect(renamed.files.map((file) => file.path).sort()).toEqual([
      "contracts/nested/account.ts",
      "contracts/user.ts",
      "index.ts",
    ]);
  });

  /** The layout is the deliverable, so a directory does not vanish with its last file. */
  it("keeps a directory that just lost its only file", () => {
    const workspace = project([
      ["schemas/user.ts", ""],
      ["index.ts", ""],
    ]);
    const { project: after } = deleteEntry(workspace, "schemas/user.ts");

    expect(after.files.map((file) => file.path)).toEqual(["index.ts"]);
    expect(directoriesOf(after)).toEqual(["schemas"]);
  });

  it("deletes a directory with everything under it", () => {
    const workspace = project([
      ["schemas/user.ts", ""],
      ["schemas/account.ts", ""],
      ["index.ts", ""],
    ]);
    const { project: after } = deleteEntry(workspace, "schemas");

    expect(after.files.map((file) => file.path)).toEqual(["index.ts"]);
    expect(after.activePath).toBe("index.ts");
  });

  it("refuses to leave the editor with nothing to edit", () => {
    const workspace = project([["index.ts", ""]]);

    expect(deleteEntry(workspace, "index.ts").problem).toMatch(/at least one file/);
  });

  it("refuses a name that is already taken", () => {
    const workspace = project([["index.ts", ""]]);

    expect(createFile(workspace, "index.ts", "").problem).toMatch(/already exists/);
    expect(createDirectory(project([["a.ts", ""]], ["dto"]), "dto").problem).toMatch(/already exists/);
  });

  it("drops the empty directory once a file lands in it", () => {
    const workspace = project([["index.ts", ""]], ["dto"]);
    const { project: after } = createFile(workspace, "dto/user.ts", "");

    expect(after.directories).toEqual([]);
    expect(directoriesOf(after)).toEqual(["dto"]);
    expect(after.activePath).toBe("dto/user.ts");
  });

  it("writes into one file without touching the others", () => {
    const workspace = project([
      ["a.ts", "one"],
      ["b.ts", "two"],
    ]);

    expect(writeFile(workspace, "a.ts", "changed").files).toEqual([
      { path: "a.ts", source: "changed" },
      { path: "b.ts", source: "two" },
    ]);
  });
});

describe("dependencies between files", () => {
  it("resolves an emitted specifier and a source one to the same file", () => {
    expect(importedPaths(`import { Base } from "./shared.js";`, "schemas/user.ts")).toEqual(["schemas/shared.ts"]);
    expect(importedPaths(`import { Base } from "../shared";`, "schemas/user.ts")).toEqual(["shared.ts"]);
  });

  it("ignores the package import, which is not a workspace file", () => {
    expect(importedPaths(`import { JIT } from "@jit-compiler/jit/runtime";`, "index.ts")).toEqual([]);
  });

  it("evaluates a dependency before the file that reads it", () => {
    const workspace = project([
      ["schemas/shared.ts", "export const Base = 1;"],
      ["schemas/user.ts", `import { Base } from "./shared.js";`],
    ]);

    expect(compilationOrder(workspace, "schemas/user.ts").map((file) => file.path)).toEqual([
      "schemas/shared.ts",
      "schemas/user.ts",
    ]);
  });

  /** A cycle is the reader's bug. Hanging the tab is not how to tell them. */
  it("stops on a cycle instead of looping", () => {
    const workspace = project([
      ["a.ts", `import { b } from "./b.js";`],
      ["b.ts", `import { a } from "./a.js";`],
    ]);

    expect(compilationOrder(workspace, "a.ts").map((file) => file.path)).toEqual(["b.ts", "a.ts"]);
  });

  it("orders the whole project with every file exactly once", () => {
    const workspace = project([
      ["index.ts", `import { User } from "./schemas/user.js";`],
      ["schemas/user.ts", `import { Base } from "./shared.js";`],
      ["schemas/shared.ts", ""],
    ]);

    expect(projectOrder(workspace).map((file) => file.path)).toEqual([
      "schemas/shared.ts",
      "schemas/user.ts",
      "index.ts",
    ]);
  });
});
