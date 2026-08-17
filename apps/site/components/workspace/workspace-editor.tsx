"use client";

import Editor, { type Monaco, type OnMount } from "@monaco-editor/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { nameOf, parentOf, type WorkspaceFile } from "@/lib/workspace/project";
import { lockEntrypoint, type WorkspaceMode } from "@/lib/workspace/store";

/**
 * The one editor the workspace has, holding the whole project.
 *
 * Every file gets a Monaco model of its own, whether or not it is on screen,
 * because that is what makes `import { User } from "./user-schemas"` resolve
 * instead of showing a missing-module error on a file that is right there in
 * the tree.
 */
export interface EditorHandle {
  /** TypeScript to JavaScript, for one file of the project. */
  transpile(path: string, source: string): Promise<string>;
  /** The first type error in a file, or null when it compiles. */
  firstDiagnostic(path: string): Promise<string | null>;
}

const EDITOR_OPTIONS = {
  minimap: { enabled: false },
  fontSize: 13,
  lineHeight: 21,
  scrollBeyondLastLine: false,
  padding: { top: 12, bottom: 16 },
  tabSize: 2,
  automaticLayout: true,
  wordWrap: "on",
  scrollbar: { verticalScrollbarSize: 8, horizontalScrollbarSize: 8 },
  renderLineHighlight: "line",
  overviewRulerLanes: 0,
  fixedOverflowWidgets: true,
  smoothScrolling: true,
} as const;

const WORKSPACE_ROOT = "file:///workspace";
const PACKAGE_ROOT = "file:///node_modules/@jit-compiler/jit";

function uriOf(path: string): string {
  return `${WORKSPACE_ROOT}/${path}`;
}

export function WorkspaceEditor({
  files,
  activePath,
  mode,
  onChange,
  onSelect,
  onReady,
}: {
  files: readonly WorkspaceFile[];
  activePath: string;
  mode: WorkspaceMode;
  onChange: (path: string, source: string) => void;
  onSelect: (path: string) => void;
  onReady: (handle: EditorHandle) => void;
}) {
  const [monaco, setMonaco] = useState<Monaco | null>(null);
  const [dts, setDts] = useState<Record<string, string> | null>(null);
  const active = files.find((file) => file.path === activePath) ?? files[0];
  const guarding = useRef(false);
  const editorRef = useRef<Parameters<OnMount>[0] | null>(null);

  useEffect(() => {
    fetch("/playground/jit-dts.json")
      .then((response) => (response.ok ? response.json() : null))
      .then((manifest) => setDts(manifest?.files ?? {}))
      .catch(() => setDts({}));
  }, []);

  /**
   * Registering the type definitions has to wait for both the editor and the
   * manifest, and neither wins reliably: on a warm cache Monaco mounts first
   * and `beforeMount` runs with nothing to register, which is what made
   * `@jit-compiler/jit/define` look like a missing module. An effect over both
   * inputs is order-independent.
   */
  useEffect(() => {
    if (!monaco || !dts) return;

    // `setExtraLibs` replaces the whole set rather than appending to it, so a
    // remount cannot register the same declaration twice and turn every jit
    // type into a duplicate-identifier error.
    monaco.languages.typescript.typescriptDefaults.setExtraLibs([
      ...Object.entries(dts).map(([path, content]) => ({ content, filePath: `${PACKAGE_ROOT}/${path}` })),
      {
        // Node-style resolution reads the manifest before the files; without it
        // the bare `@jit-compiler/jit` specifier has nothing to point at.
        content: JSON.stringify({ name: "@jit-compiler/jit", version: "0.0.0", types: "index.d.ts" }),
        filePath: `${PACKAGE_ROOT}/package.json`,
      },
    ]);

    /**
     * The handle is published only now, once the jit types exist. Handing it
     * over at mount would let Generate type-check against a package that has
     * not been registered yet and fail with a "cannot find module" the reader
     * cannot act on.
     */
    onReady(createHandle(monaco));
  }, [monaco, dts, onReady]);

  /**
   * One model per file, kept in step with the tree. A file the reader deleted
   * has to lose its model too, or its declarations keep resolving and the
   * editor disagrees with the project about what exists.
   */
  useEffect(() => {
    if (!monaco) return;

    const wanted = new Set(files.map((file) => uriOf(file.path)));

    for (const file of files) {
      const uri = monaco.Uri.parse(uriOf(file.path));
      const model = monaco.editor.getModel(uri);

      if (!model) monaco.editor.createModel(file.source, "typescript", uri);
      // the active file's model is driven by the editor's own value prop
      else if (file.path !== activePath && model.getValue() !== file.source) model.setValue(file.source);
    }

    for (const model of monaco.editor.getModels()) {
      const uri = model.uri.toString();
      if (uri.startsWith(`${WORKSPACE_ROOT}/`) && !wanted.has(uri)) model.dispose();
    }
  }, [monaco, files, activePath]);

  const beforeMount = useCallback((instance: Monaco) => {
    instance.editor.defineTheme("jit-night", {
      base: "vs-dark",
      inherit: true,
      rules: [
        { token: "keyword", foreground: "c69cff" },
        { token: "type.identifier", foreground: "7db7ff" },
        { token: "string", foreground: "9dd8a8" },
        { token: "number", foreground: "ffb86b" },
        { token: "comment", foreground: "6f777b" },
      ],
      colors: {
        "editor.background": "#121520",
        "editor.foreground": "#e8e2c5",
        "editorLineNumber.foreground": "#454d50",
        "editorLineNumber.activeForeground": "#777f82",
        "editorIndentGuide.background1": "#1d222b",
        "editorWidget.background": "#171b25",
        "editorSuggestWidget.background": "#171b25",
        "editorSuggestWidget.selectedBackground": "#23292f",
        "input.background": "#121520",
      },
    });

    const ts = instance.languages.typescript;
    ts.typescriptDefaults.setCompilerOptions({
      target: ts.ScriptTarget.ESNext,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.NodeJs,
      strict: true,
      esModuleInterop: true,
      allowNonTsExtensions: true,
      skipLibCheck: true,
    });
    ts.typescriptDefaults.setEagerModelSync(true);
  }, []);

  /**
   * The entrypoint line is refused rather than corrected.
   *
   * Restoring it after the fact still lets the reader watch it change under
   * their cursor, which reads as the editor fighting them. Blocking the
   * keystroke while the selection is on line 1 means the line simply cannot be
   * typed into; `lockEntrypoint` stays as the backstop for a paste or an undo,
   * which no key handler sees.
   */
  const onMount = useCallback<OnMount>((instance, monacoInstance) => {
    editorRef.current = instance;
    setMonaco(monacoInstance);

    instance.onKeyDown((event) => {
      const selection = instance.getSelection();
      if (!selection || selection.startLineNumber > 1) return;

      const harmless =
        event.metaKey ||
        event.ctrlKey ||
        [
          "ArrowLeft",
          "ArrowRight",
          "ArrowUp",
          "ArrowDown",
          "Home",
          "End",
          "PageUp",
          "PageDown",
          "Escape",
          "Tab",
        ].includes(event.browserEvent.key);
      if (harmless) return;

      event.preventDefault();
      event.stopPropagation();
    });
  }, []);

  /** The locked line, greyed and marked, so it reads as chrome rather than code. */
  // biome-ignore lint/correctness/useExhaustiveDependencies(activePath): the decoration belongs to the model on screen, so switching files has to redraw it
  // biome-ignore lint/correctness/useExhaustiveDependencies(mode): the line it marks is the entrypoint the mode chose
  useEffect(() => {
    const instance = editorRef.current;
    if (!instance || !monaco) return;

    const collection = instance.createDecorationsCollection([
      {
        range: new monaco.Range(1, 1, 1, 1),
        options: {
          isWholeLine: true,
          className: "workspace-locked-line",
          linesDecorationsClassName: "workspace-locked-gutter",
          hoverMessage: {
            value: "The workspace owns this line. Run and Generate differ only in which subpath it names.",
          },
        },
      },
    ]);

    return () => collection.clear();
  }, [monaco, activePath, mode]);

  /**
   * The entrypoint import is the workspace's line, so an edit that breaks it
   * is undone rather than reported. Restoring is one model write, and the
   * guard flag keeps that write from being read as another edit.
   */
  const handleChange = useCallback(
    (value: string | undefined) => {
      if (guarding.current || !active) return;

      const source = value ?? "";
      const locked = lockEntrypoint(source, mode);

      if (locked === source) {
        onChange(active.path, source);
        return;
      }

      guarding.current = true;
      monaco?.editor.getModel(monaco.Uri.parse(uriOf(active.path)))?.setValue(locked);
      guarding.current = false;
      onChange(active.path, locked);
    },
    [active, mode, monaco, onChange]
  );

  if (!active) return null;

  return (
    <div className="flex h-full min-h-0 flex-col bg-night-1000">
      {/* the tab strip: which file is open, and every other one a click away */}
      <div
        role="tablist"
        aria-label="Open files"
        className="flex shrink-0 items-stretch overflow-x-auto border-b border-line-subtle bg-night-950"
      >
        {files.map((file) => {
          const current = file.path === active.path;

          return (
            <button
              key={file.path}
              type="button"
              role="tab"
              aria-selected={current}
              onClick={() => onSelect(file.path)}
              title={file.path}
              className={`group relative flex shrink-0 items-center gap-1.5 border-r border-line-subtle px-3 py-1.5 font-mono text-[11px] transition-colors ${
                current ? "bg-night-1000 text-ghost-100" : "text-fg-subtle hover:bg-surface-800/40 hover:text-fg-muted"
              }`}
            >
              {current && <span aria-hidden className="absolute inset-x-0 top-0 h-px bg-gold-200" />}
              <span className={current ? "text-gold-200" : "text-fg-subtle/70"}>TS</span>
              <span>{nameOf(file.path)}</span>
              {parentOf(file.path) && <span className="text-fg-subtle/60">{parentOf(file.path)}</span>}
            </button>
          );
        })}
      </div>

      <div className="min-h-0 flex-1">
        <Editor
          height="100%"
          path={uriOf(active.path)}
          defaultLanguage="typescript"
          theme="jit-night"
          value={active.source}
          onChange={handleChange}
          beforeMount={beforeMount}
          onMount={onMount}
          options={EDITOR_OPTIONS}
          loading={<span className="font-mono text-xs text-fg-subtle">loading the editor…</span>}
        />
      </div>
    </div>
  );
}

/** Both panels reach the TypeScript worker through this. */
function createHandle(monaco: Monaco): EditorHandle {
  const client = async (path: string) => {
    const uri = monaco.Uri.parse(uriOf(path));
    const getWorker = await monaco.languages.typescript.getTypeScriptWorker();
    return { worker: await getWorker(uri), uri };
  };

  return {
    async transpile(path, source) {
      try {
        const { worker, uri } = await client(path);
        const output = await worker.getEmitOutput(uri.toString());
        return output.outputFiles[0]?.text ?? source;
      } catch {
        // plain-JS snippets still run: the worker strips the import itself
        return source;
      }
    },
    async firstDiagnostic(path) {
      try {
        const { worker, uri } = await client(path);
        const [syntactic, semantic] = await Promise.all([
          worker.getSyntacticDiagnostics(uri.toString()),
          worker.getSemanticDiagnostics(uri.toString()),
        ]);

        const issue = [...syntactic, ...semantic][0];
        return issue ? flattenDiagnostic(issue.messageText) : null;
      } catch {
        return null;
      }
    },
  };
}

function flattenDiagnostic(message: unknown): string {
  if (typeof message === "string") return message;
  if (message !== null && typeof message === "object" && "messageText" in message) {
    return String((message as { messageText: unknown }).messageText);
  }
  return "TypeScript compilation failed";
}
