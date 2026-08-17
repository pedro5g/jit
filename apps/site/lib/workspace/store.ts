"use client";

import { useCallback, useEffect, useState } from "react";
import { takePendingWorkspaceWrite, WORKSPACE_WRITE_EVENT, type WorkspaceWriteDetail } from "@/lib/assistant/bus";
import { DEFAULT_CODE } from "./operations";

export type WorkspaceMode = "run" | "generate";

/**
 * One schema, two destinations. Running it and generating an artifact from it
 * differ only in which entrypoint the source imports, so the editor holds the
 * schema and the mode decides the import — rather than the reader keeping two
 * copies of the same declaration in two separate pages.
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

/** The body without its import, which is what the ghost reads and writes. */
export function schemaBody(code: string): string {
  return code.replace(IMPORT_LINE, "").trim();
}

export interface GhostEdit {
  /** The code the editor held before the ghost replaced it. */
  previous: string;
  reason: string;
}

export function useWorkspaceCode() {
  const [code, setCode] = useState(DEFAULT_CODE);
  const [mode, setMode] = useState<WorkspaceMode>("run");
  const [ghostEdit, setGhostEdit] = useState<GhostEdit | null>(null);

  /**
   * The ghost writes into the editor rather than asking the reader to copy a
   * snippet — but it never destroys work silently, so the previous source is
   * kept and one click puts it back.
   */
  const applyWrite = useCallback((detail: WorkspaceWriteDetail) => {
    setCode((current) => {
      setGhostEdit({ previous: current, reason: detail.reason });
      return withEntrypoint(detail.code, detail.mode);
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

  const undoGhostEdit = useCallback(() => {
    setGhostEdit((edit) => {
      if (edit) setCode(edit.previous);
      return null;
    });
  }, []);

  return {
    code,
    setCode: useCallback((next: string) => {
      setCode(next);
      setGhostEdit(null);
    }, []),
    mode,
    setMode,
    ghostEdit,
    dismissGhostEdit: useCallback(() => setGhostEdit(null), []),
    undoGhostEdit,
  };
}
