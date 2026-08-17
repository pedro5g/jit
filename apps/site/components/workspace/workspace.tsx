"use client";

import { AlertTriangle, Check, Code2, PackageCheck, Play, Undo2, X } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { JitLogo } from "@/components/brand/jit-logo";
import { Select } from "@/components/ui/select";
import { openAssistant, publishEditorCode } from "@/lib/assistant/bus";
import { EXAMPLES } from "@/lib/workspace/operations";
import { useWorkspaceCode, type WorkspaceMode, withEntrypoint } from "@/lib/workspace/store";
import { GeneratePanel } from "./generate-panel";
import { RunPanel } from "./run-panel";
import { type EditorHandle, WorkspaceEditor } from "./workspace-editor";

/**
 * One schema, one editor, two things to do with it: run it against values, or
 * generate the module a project would ship. They used to be separate pages
 * with separate editors, which meant declaring the same schema twice to see
 * both halves of what jit does.
 *
 * Below the split point the two panes become one at a time. Half a screen of
 * editor above half a screen of output is worse than either on a phone, so the
 * layout switches rather than shrinks.
 */
export function Workspace({ initialMode = "run" }: { initialMode?: WorkspaceMode }) {
  const workspace = useWorkspaceCode();
  const [editor, setEditor] = useState<EditorHandle | null>(null);
  const [mode, setMode] = useState<WorkspaceMode>(initialMode);
  const [narrowPane, setNarrowPane] = useState<"editor" | "panel">("editor");
  const [diagnostic, setDiagnostic] = useState<string | null>(null);
  const [loadedExample, setLoadedExample] = useState("");

  // a write from the ghost carries the mode it was meant for
  const activeMode = workspace.ghostEdit ? workspace.mode : mode;
  const onReady = useCallback((handle: EditorHandle) => setEditor(handle), []);

  // the ghost replacing the source means the named example is no longer loaded
  useEffect(() => {
    if (workspace.ghostEdit) setLoadedExample("");
  }, [workspace.ghostEdit]);

  // the ghost answers about the schema on screen, so it has to see it
  useEffect(() => {
    publishEditorCode(workspace.code);
    return () => publishEditorCode(null);
  }, [workspace.code]);

  /**
   * Type errors are surfaced continuously rather than only when Generate runs,
   * because the most common one — an import that did not resolve — otherwise
   * looks like the editor silently not working.
   */
  // biome-ignore lint/correctness/useExhaustiveDependencies(workspace.code): the edited source is the trigger, not an input — Monaco holds the model
  useEffect(() => {
    if (!editor) return;

    const timer = setTimeout(() => {
      void editor.firstDiagnostic().then(setDiagnostic);
    }, 600);

    return () => clearTimeout(timer);
  }, [editor, workspace.code]);

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-night-1000">
      <header className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-b border-line-subtle bg-night-950 px-3 py-2 sm:px-4">
        <Link href="/" aria-label="jit home" className="shrink-0">
          <JitLogo />
        </Link>

        <div className="flex shrink-0 items-center gap-0.5 rounded-control border border-line-subtle bg-night-1000 p-0.5">
          <ModeTab
            active={activeMode === "run"}
            onClick={() => setMode("run")}
            icon={<Play aria-hidden className="size-3" />}
            label="Run"
          />
          <ModeTab
            active={activeMode === "generate"}
            onClick={() => setMode("generate")}
            icon={<PackageCheck aria-hidden className="size-3" />}
            label="Generate"
          />
        </div>

        <div className="min-w-40 max-w-56 flex-1">
          <Select
            ariaLabel="Load an example"
            value={loadedExample}
            options={[
              { value: "", label: "Examples", description: "Replace the editor with a ready-made schema" },
              ...EXAMPLES.map((example) => ({ value: example.id, label: example.label })),
            ]}
            onValueChange={(value) => {
              const example = EXAMPLES.find((item) => item.id === value);
              if (!example) return;
              setLoadedExample(example.id);
              workspace.setCode(withEntrypoint(example.code, activeMode));
            }}
          />
        </div>

        <div className="ml-auto flex shrink-0 items-center gap-2">
          <DiagnosticPill diagnostic={diagnostic} ready={editor !== null} />
          <button
            type="button"
            onClick={() => openAssistant("Explain what this schema compiles to")}
            className="rounded-control border border-line-gold/50 bg-gold-200/10 px-2.5 py-1.5 text-xs text-gold-200 transition-colors hover:bg-gold-200/20"
          >
            Ask the ghost
          </button>
        </div>
      </header>

      {workspace.ghostEdit && (
        <div className="flex shrink-0 items-center gap-2 border-b border-line-gold/30 bg-gold-200/5 px-3 py-1.5 sm:px-4">
          <p className="flex-1 truncate font-mono text-[11px] text-gold-200">
            The editor was {workspace.ghostEdit.reason}.
          </p>
          <button
            type="button"
            onClick={workspace.undoGhostEdit}
            className="inline-flex shrink-0 items-center gap-1 rounded-control border border-line-subtle px-2 py-0.5 text-[11px] text-fg-muted transition-colors hover:border-line-gold hover:text-gold-200"
          >
            <Undo2 aria-hidden className="size-3" />
            undo
          </button>
          <button
            type="button"
            aria-label="Dismiss"
            onClick={workspace.dismissGhostEdit}
            className="inline-flex size-5 shrink-0 items-center justify-center rounded-md text-fg-subtle hover:text-ghost-100"
          >
            <X aria-hidden className="size-3" />
          </button>
        </div>
      )}

      {/* one pane at a time below lg, where two would each be unusable */}
      <div className="flex shrink-0 items-center gap-0.5 border-b border-line-subtle bg-night-950 px-3 py-1.5 lg:hidden">
        <PaneTab
          active={narrowPane === "editor"}
          onClick={() => setNarrowPane("editor")}
          icon={<Code2 aria-hidden className="size-3" />}
          label="Schema"
        />
        <PaneTab
          active={narrowPane === "panel"}
          onClick={() => setNarrowPane("panel")}
          icon={
            activeMode === "run" ? (
              <Play aria-hidden className="size-3" />
            ) : (
              <PackageCheck aria-hidden className="size-3" />
            )
          }
          label={activeMode === "run" ? "Run" : "Generate"}
        />
      </div>

      <main className="grid min-h-0 flex-1 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)]">
        <section
          aria-label="Schema editor"
          className={`min-h-0 border-line-subtle lg:block lg:border-r ${narrowPane === "editor" ? "block" : "hidden"}`}
        >
          <WorkspaceEditor code={workspace.code} onChange={workspace.setCode} onReady={onReady} />
        </section>

        <section
          aria-label={activeMode === "run" ? "Run the schema" : "Generate an artifact"}
          className={`min-h-0 bg-night-950 lg:block ${narrowPane === "panel" ? "block" : "hidden"}`}
        >
          {activeMode === "run" ? (
            <RunPanel code={withEntrypoint(workspace.code, "run")} editor={editor} />
          ) : (
            <GeneratePanel code={withEntrypoint(workspace.code, "generate")} editor={editor} />
          )}
        </section>
      </main>
    </div>
  );
}

function ModeTab({
  active,
  onClick,
  label,
  icon,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  icon: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs transition-colors ${
        active ? "bg-gold-200/15 text-gold-200" : "text-fg-muted hover:text-ghost-100"
      }`}
    >
      {icon}
      {label}
    </button>
  );
}

function PaneTab({
  active,
  onClick,
  label,
  icon,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  icon: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`inline-flex flex-1 items-center justify-center gap-1.5 rounded-control py-1 font-mono text-[11px] transition-colors ${
        active ? "bg-surface-800 text-ghost-100" : "text-fg-subtle hover:text-ghost-100"
      }`}
    >
      {icon}
      {label}
    </button>
  );
}

/** Continuous type-check state, in the smallest form that still says enough. */
function DiagnosticPill({ diagnostic, ready }: { diagnostic: string | null; ready: boolean }) {
  if (!ready) return null;

  if (!diagnostic) {
    return (
      <span
        title="The schema type-checks"
        className="hidden items-center gap-1 rounded-pill border border-success/30 px-2 py-0.5 font-mono text-[10px] text-success sm:inline-flex"
      >
        <Check aria-hidden className="size-2.5" />
        types ok
      </span>
    );
  }

  return (
    <span
      title={diagnostic}
      className="hidden max-w-56 items-center gap-1 rounded-pill border border-warning/40 px-2 py-0.5 font-mono text-[10px] text-warning sm:inline-flex"
    >
      <AlertTriangle aria-hidden className="size-2.5 shrink-0" />
      <span className="truncate">{diagnostic}</span>
    </span>
  );
}
