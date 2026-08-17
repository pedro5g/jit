/**
 * The workspace holds a project, not a file.
 *
 * A schema layer is never one file. It is `schemas/user.ts` beside
 * `schemas/account.ts`, sharing a `shared.ts`, and the shape of that layout is
 * a decision worth keeping — it is the shape the CLI reconstructs into the
 * reader's repository. So the editor declares a tree, generation mirrors it,
 * and the artifact carries it.
 *
 * Everything here is pure. The React layer owns persistence and rendering; the
 * rules about what a path may be, what depends on what, and what happens when
 * a directory is renamed are decided once, in one place that a test can reach.
 */

export interface WorkspaceFile {
  /** Portable relative path below the project root: `schemas/user.ts`. */
  path: string;
  source: string;
}

export interface WorkspaceProject {
  files: WorkspaceFile[];
  /**
   * Directories that hold no file. A directory with files in it is implied by
   * their paths; one a reader made and has not filled yet only exists here,
   * and dropping it would silently change the layout they declared.
   */
  directories: string[];
  /** The file the editor is showing. */
  activePath: string;
}

/** Characters a portable filesystem refuses, control characters aside. */
const UNSAFE_IN_A_NAME = /[<>:"|?*]/;

/** The longest path the artifact protocol accepts. */
const MAX_PATH_LENGTH = 240;
const SOURCE_EXTENSION = ".ts";

/**
 * Exactly the paths the artifact protocol accepts, checked here so a reader
 * finds out while typing a name rather than when the CLI refuses the token.
 */
export function pathProblem(path: string): string | null {
  if (path.length === 0) return "A name is required.";
  if (path.length > MAX_PATH_LENGTH) return `A path may be at most ${MAX_PATH_LENGTH} characters.`;
  if (path.startsWith("/")) return "A path is relative to the project root, so it cannot start with /.";
  if (path.includes("\\")) return "Use / to separate directories.";

  for (const segment of path.split("/")) {
    if (segment.length === 0) return "A path cannot contain an empty segment.";
    if (segment === "." || segment === "..") return "A path cannot navigate with . or ..";
    if (UNSAFE_IN_A_NAME.test(segment) || [...segment].some((character) => character < " ")) {
      return `"${segment}" contains a character a filesystem cannot store.`;
    }
  }

  return null;
}

export function fileProblem(path: string): string | null {
  const problem = pathProblem(path);
  if (problem) return problem;
  if (!path.endsWith(SOURCE_EXTENSION)) return "A schema file ends in .ts";
  if (path.slice(0, -SOURCE_EXTENSION.length).endsWith("/")) return "A file needs a name before .ts";

  return null;
}

/** `schemas/user.ts` -> `schemas`. The root is the empty string. */
export function parentOf(path: string): string {
  const cut = path.lastIndexOf("/");
  return cut === -1 ? "" : path.slice(0, cut);
}

export function nameOf(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

/** Whether `path` is inside `directory`, which is not true of the directory itself. */
export function isInside(path: string, directory: string): boolean {
  return directory === "" ? path.includes("/") : path.startsWith(`${directory}/`);
}

/** Every directory the project has, whether declared or implied by a file. */
export function directoriesOf(project: WorkspaceProject): string[] {
  const directories = new Set(project.directories);

  for (const file of project.files) {
    let parent = parentOf(file.path);
    while (parent !== "") {
      directories.add(parent);
      parent = parentOf(parent);
    }
  }

  return [...directories].sort();
}

export function fileAt(project: WorkspaceProject, path: string): WorkspaceFile | undefined {
  return project.files.find((file) => file.path === path);
}

export type TreeNode =
  | { kind: "directory"; name: string; path: string; children: TreeNode[] }
  | { kind: "file"; name: string; path: string };

/**
 * The explorer's view. Directories before files and both alphabetical, so the
 * tree does not reorder itself as a reader types.
 */
export function buildTree(project: WorkspaceProject): TreeNode[] {
  const directories = directoriesOf(project);

  const childrenOf = (parent: string): TreeNode[] => {
    const nodes: TreeNode[] = directories
      .filter((directory) => parentOf(directory) === parent)
      .map((directory) => ({
        kind: "directory" as const,
        name: nameOf(directory),
        path: directory,
        children: childrenOf(directory),
      }));

    const files: TreeNode[] = project.files
      .filter((file) => parentOf(file.path) === parent)
      .map((file) => ({ kind: "file" as const, name: nameOf(file.path), path: file.path }))
      .sort((left, right) => left.name.localeCompare(right.name));

    return [...nodes, ...files];
  };

  return childrenOf("");
}

export interface ProjectChange {
  project: WorkspaceProject;
  /** Set when nothing changed, and why. */
  problem?: string;
}

function unchanged(project: WorkspaceProject, problem: string): ProjectChange {
  return { project, problem };
}

export function createFile(project: WorkspaceProject, path: string, source: string): ProjectChange {
  const problem = fileProblem(path);
  if (problem) return unchanged(project, problem);
  if (fileAt(project, path)) return unchanged(project, `${path} already exists.`);

  return {
    project: {
      ...project,
      files: [...project.files, { path, source }],
      // the directory is implied by the file now
      directories: project.directories.filter((directory) => directory !== parentOf(path)),
      activePath: path,
    },
  };
}

export function createDirectory(project: WorkspaceProject, path: string): ProjectChange {
  const problem = pathProblem(path);
  if (problem) return unchanged(project, problem);
  if (directoriesOf(project).includes(path)) return unchanged(project, `${path} already exists.`);
  if (fileAt(project, path)) return unchanged(project, `${path} is a file.`);

  return { project: { ...project, directories: [...project.directories, path] } };
}

export function writeFile(project: WorkspaceProject, path: string, source: string): WorkspaceProject {
  return {
    ...project,
    files: project.files.map((file) => (file.path === path ? { ...file, source } : file)),
  };
}

/**
 * Renames a file, or a directory and everything under it.
 *
 * Moving a directory rewrites the paths of its contents rather than asking the
 * reader to move each file, which is the difference between a tree and a list
 * of files that happen to share a prefix.
 */
export function renameEntry(project: WorkspaceProject, from: string, to: string): ProjectChange {
  const isFile = Boolean(fileAt(project, from));
  const problem = isFile ? fileProblem(to) : pathProblem(to);
  if (problem) return unchanged(project, problem);
  if (from === to) return { project };

  if (isFile) {
    if (fileAt(project, to)) return unchanged(project, `${to} already exists.`);

    return {
      project: {
        ...project,
        files: project.files.map((file) => (file.path === from ? { ...file, path: to } : file)),
        directories: project.directories.filter((directory) => directory !== parentOf(to)),
        activePath: project.activePath === from ? to : project.activePath,
      },
    };
  }

  if (!directoriesOf(project).includes(from)) return unchanged(project, `${from} does not exist.`);
  if (directoriesOf(project).includes(to)) return unchanged(project, `${to} already exists.`);

  const moved = (path: string) => (isInside(path, from) ? `${to}${path.slice(from.length)}` : path);

  return {
    project: {
      files: project.files.map((file) => ({ ...file, path: moved(file.path) })),
      directories: project.directories.map((directory) => (directory === from ? to : moved(directory))),
      activePath: moved(project.activePath),
    },
  };
}

/**
 * Deletes a file, or a directory with everything under it. The project always
 * keeps one file: an editor with nothing to edit is a broken screen, and there
 * is no state where deleting the last file is what someone meant.
 */
export function deleteEntry(project: WorkspaceProject, path: string): ProjectChange {
  const isFile = Boolean(fileAt(project, path));

  if (isFile) {
    if (project.files.length === 1) return unchanged(project, "A project keeps at least one file.");

    const files = project.files.filter((file) => file.path !== path);
    return {
      project: {
        ...project,
        files,
        // the directory it was in survives its last file
        directories:
          parentOf(path) !== "" && !files.some((file) => isInside(file.path, parentOf(path)))
            ? [...project.directories, parentOf(path)]
            : project.directories,
        activePath: project.activePath === path ? (files[0]?.path ?? "") : project.activePath,
      },
    };
  }

  const files = project.files.filter((file) => !isInside(file.path, path));
  if (files.length === 0) return unchanged(project, "A project keeps at least one file.");

  return {
    project: {
      files,
      directories: project.directories.filter((directory) => directory !== path && !isInside(directory, path)),
      activePath: files.some((file) => file.path === project.activePath) ? project.activePath : (files[0]?.path ?? ""),
    },
  };
}

/**
 * Workspace files a source imports.
 *
 * TypeScript's ESM convention writes the emitted specifier, so `./shared.js`
 * means `shared.ts` on disk. Both are accepted, because a reader copying an
 * example out of the documentation writes the first and a reader typing from
 * memory writes the second.
 */
export function importedPaths(source: string, from: string): string[] {
  const directory = parentOf(from);
  const paths: string[] = [];

  for (const match of source.matchAll(/\bfrom\s+["'](\.[^"']*)["']/g)) {
    const specifier = match[1];
    if (!specifier) continue;

    const resolved = resolveRelative(directory, specifier.replace(/\.(?:js|ts)$/, ""));
    if (resolved !== null) paths.push(`${resolved}${SOURCE_EXTENSION}`);
  }

  return paths;
}

function resolveRelative(directory: string, specifier: string): string | null {
  const segments = directory === "" ? [] : directory.split("/");

  for (const segment of specifier.split("/")) {
    if (segment === "." || segment === "") continue;
    if (segment === "..") {
      if (segments.pop() === undefined) return null;
      continue;
    }
    segments.push(segment);
  }

  return segments.length > 0 ? segments.join("/") : null;
}

/**
 * The files that have to be evaluated before this one, then this one.
 *
 * The compiler is handed one program per file, so a file that reads a schema
 * from another needs that other file's declarations in scope. Dependencies
 * come first, each appears once, and a cycle stops rather than looping — a
 * cycle is the reader's bug, and hanging the tab is not how to report it.
 */
export function compilationOrder(project: WorkspaceProject, path: string): WorkspaceFile[] {
  const ordered: WorkspaceFile[] = [];
  const visited = new Set<string>();

  const visit = (current: string) => {
    if (visited.has(current)) return;
    visited.add(current);

    const file = fileAt(project, current);
    if (!file) return;

    for (const dependency of importedPaths(file.source, current)) visit(dependency);
    ordered.push(file);
  };

  visit(path);
  return ordered;
}

/** Every file, in an order where a dependency always precedes its dependents. */
export function projectOrder(project: WorkspaceProject): WorkspaceFile[] {
  const ordered: WorkspaceFile[] = [];
  const seen = new Set<string>();

  for (const file of [...project.files].sort((left, right) => left.path.localeCompare(right.path))) {
    for (const dependency of compilationOrder(project, file.path)) {
      if (seen.has(dependency.path)) continue;
      seen.add(dependency.path);
      ordered.push(dependency);
    }
  }

  return ordered;
}
