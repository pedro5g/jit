"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { takePendingWorkspaceWrite, WORKSPACE_WRITE_EVENT, type WorkspaceWriteDetail } from "@/lib/assistant/bus";
import { STARTER_PROJECT } from "./operations";
import {
  createDirectory,
  createFile,
  deleteEntry,
  fileAt,
  type ProjectChange,
  renameEntry,
  type WorkspaceFile,
  type WorkspaceProject,
  writeFile,
} from "./project";

export type WorkspaceMode = "run" | "generate";

/**
 * One schema, two destinations. Running it and generating an artifact from it
 * differ only in which entrypoint the source imports, so the editor holds the
 * schema and the mode decides the import — rather than the reader keeping two
 * copies of the same declaration in two separate files.
 */
const ENTRYPOINTS: Record<WorkspaceMode, string> = {
  run: "@jit-compiler/jit/runtime",
  generate: "@jit-compiler/jit/define",
};

// Horizontal whitespace only: `\s` would match the newlines around the import
// and swallow the blank line the reader put between it and their schema.
const IMPORT_LINE = /^[ \t]*import[ \t]+\{[ \t]*JIT[^}]*\}[ \t]+from[ \t]+["']@jit-compiler\/jit[^"']*["'];?[ \t]*$/m;

/** Rewrites (or adds) the jit import so the source suits the chosen mode. */
export function withEntrypoint(code: string, mode: WorkspaceMode): string {
  const statement = `import { JIT } from "${ENTRYPOINTS[mode]}";`;
  if (IMPORT_LINE.test(code)) return code.replace(IMPORT_LINE, statement);

  return `${statement}\n\n${code}`;
}

/** The import line a file in this mode must carry, exactly. */
export function entrypointLine(mode: WorkspaceMode): string {
  return `import { JIT } from "${ENTRYPOINTS[mode]}";`;
}

/** Any import of the package, however the reader mangled it. */
const ANY_JIT_IMPORT = /^[ \t]*import[^\n]*from[ \t]*["']@jit-compiler\/jit[^"']*["'];?[ \t]*$/gm;

/**
 * The entrypoint is the workspace's, not the reader's.
 *
 * Which subpath a file imports is what Run and Generate disagree about, and it
 * is the one line in the buffer that has a right answer: `/runtime` compiles in
 * memory, `/define` is what the generator reads. An edited specifier does not
 * fail loudly — it produces a module error that reads like the editor is
 * broken — so the line is restored rather than diagnosed.
 */
export function lockEntrypoint(code: string, mode: WorkspaceMode): string {
  const body = code.replace(ANY_JIT_IMPORT, "").replace(/^\n+/, "");

  return `${entrypointLine(mode)}\n${body.startsWith("\n") ? "" : "\n"}${body}`;
}

/** The body without its import, which is what the ghost reads and writes. */
export function schemaBody(code: string): string {
  return code.replace(IMPORT_LINE, "").trim();
}

export interface GhostEdit {
  /** The project before the ghost changed it. */
  previous: WorkspaceProject;
  reason: string;
  /** The file it wrote. */
  path: string;
}

/** Where the reader's project lives between visits. */
const STORAGE_KEY = "jit.workspace.project.v1";

function restore(): WorkspaceProject | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;

    const parsed = JSON.parse(raw) as Partial<WorkspaceProject>;
    if (!Array.isArray(parsed.files) || parsed.files.length === 0) return null;
    if (!parsed.files.every((file) => typeof file?.path === "string" && typeof file?.source === "string")) return null;

    return {
      files: parsed.files as WorkspaceFile[],
      directories: Array.isArray(parsed.directories)
        ? parsed.directories.filter((value): value is string => typeof value === "string")
        : [],
      activePath: typeof parsed.activePath === "string" ? parsed.activePath : (parsed.files[0]?.path ?? ""),
    };
  } catch {
    return null;
  }
}

export function useWorkspaceProject() {
  const [project, setProject] = useState<WorkspaceProject>(STARTER_PROJECT);
  const [mode, setMode] = useState<WorkspaceMode>("run");
  const [ghostEdit, setGhostEdit] = useState<GhostEdit | null>(null);
  /** The last thing the workspace refused to do, and why. */
  const [problem, setProblem] = useState<string | null>(null);

  // Reading storage during render would differ between the server and the
  // first client paint, so the starter project renders and the reader's own
  // replaces it once the component is alive.
  useEffect(() => {
    const stored = restore();
    if (stored) setProject(stored);
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(project));
    } catch {
      // a full or blocked store costs persistence, not the session
    }
  }, [project]);

  /**
   * The ghost writes into the tree rather than asking the reader to copy a
   * snippet — but it never destroys work silently, so the project it replaced
   * is kept and one click puts it back.
   */
  const applyWrite = useCallback((detail: WorkspaceWriteDetail) => {
    setProject((current) => {
      const path = detail.path && fileAt(current, detail.path) ? detail.path : current.activePath;
      const source = withEntrypoint(detail.code, detail.mode);
      const next = fileAt(current, path)
        ? { ...writeFile(current, path, source), activePath: path }
        : createFile(current, detail.path ?? path, source).project;

      setGhostEdit({ previous: current, reason: detail.reason, path });
      return next;
    });
    setMode(detail.mode);
  }, []);

  useEffect(() => {
    // written while the workspace was on another route
    const pending = takePendingWorkspaceWrite();
    if (pending) applyWrite(pending);

    const onWrite = (event: Event) => {
      const custom = event as CustomEvent<WorkspaceWriteDetail>;
      // claims the edit, so the sender knows it does not need to navigate
      custom.preventDefault();
      applyWrite(custom.detail);
    };

    window.addEventListener(WORKSPACE_WRITE_EVENT, onWrite);
    return () => window.removeEventListener(WORKSPACE_WRITE_EVENT, onWrite);
  }, [applyWrite]);

  const activeFile = useMemo(() => fileAt(project, project.activePath) ?? project.files[0], [project]);

  return {
    project,
    activeFile,
    mode,
    setMode,
    problem,
    dismissProblem: useCallback(() => setProblem(null), []),

    setActive: useCallback((path: string) => {
      setProject((current) => (fileAt(current, path) ? { ...current, activePath: path } : current));
    }, []),

    setSource: useCallback((path: string, source: string) => {
      setProject((current) => writeFile(current, path, source));
      setGhostEdit(null);
    }, []),

    addFile: useCallback(
      (path: string) => {
        setProject((current) => {
          const change = createFile(current, path, withEntrypoint("", mode).trimEnd() + "\n");
          setProblem(change.problem ?? null);
          return change.problem ? current : change.project;
        });
      },
      [mode]
    ),

    addDirectory: useCallback(
      (path: string) => setProject((current) => applyChange(createDirectory(current, path), setProblem)),
      []
    ),
    rename: useCallback(
      (from: string, to: string) => setProject((current) => applyChange(renameEntry(current, from, to), setProblem)),
      []
    ),
    remove: useCallback(
      (path: string) => setProject((current) => applyChange(deleteEntry(current, path), setProblem)),
      []
    ),
    replaceProject: useCallback((next: WorkspaceProject) => {
      setProject(next);
      setGhostEdit(null);
      setProblem(null);
    }, []),

    ghostEdit,
    dismissGhostEdit: useCallback(() => setGhostEdit(null), []),
    undoGhostEdit: useCallback(() => {
      setGhostEdit((edit) => {
        if (edit) setProject(edit.previous);
        return null;
      });
    }, []),
  };
}

/** A change the project may refuse: the reason is kept, the project is not. */
function applyChange(change: ProjectChange, report: (problem: string | null) => void): WorkspaceProject {
  report(change.problem ?? null);
  return change.project;
}
