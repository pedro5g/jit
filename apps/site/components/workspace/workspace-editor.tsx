"use client";

import Editor, { type Monaco } from "@monaco-editor/react";
import { useCallback, useEffect, useState } from "react";

/**
 * The one editor the workspace has. Both the run panel and the generate panel
 * read from it, so Monaco is configured once — theme, jit type definitions,
 * and the TypeScript worker both panels transpile through.
 */
export interface EditorHandle {
  /** TypeScript to JavaScript, using Monaco's own worker. */
  transpile(source: string): Promise<string>;
  /** The first type error, or null when the source compiles. */
  firstDiagnostic(): Promise<string | null>;
}

const EDITOR_OPTIONS = {
  minimap: { enabled: false },
  fontSize: 13,
  lineHeight: 21,
  scrollBeyondLastLine: false,
  padding: { top: 16, bottom: 16 },
  tabSize: 2,
  automaticLayout: true,
  wordWrap: "on",
  scrollbar: { verticalScrollbarSize: 8, horizontalScrollbarSize: 8 },
  renderLineHighlight: "line",
  overviewRulerLanes: 0,
  fixedOverflowWidgets: true,
  smoothScrolling: true,
} as const;

const FILE_URI = "file:///workspace/schema.ts";
const PACKAGE_ROOT = "file:///node_modules/@jit-compiler/jit";

export function WorkspaceEditor({
  code,
  onChange,
  onReady,
}: {
  code: string;
  onChange: (value: string) => void;
  onReady: (handle: EditorHandle) => void;
}) {
  const [monaco, setMonaco] = useState<Monaco | null>(null);
  const [dts, setDts] = useState<Record<string, string> | null>(null);

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

  const onMount = useCallback((_editor: unknown, instance: Monaco) => setMonaco(instance), []);

  return (
    <Editor
      height="100%"
      path={FILE_URI}
      defaultLanguage="typescript"
      theme="jit-night"
      value={code}
      onChange={(value) => onChange(value ?? "")}
      beforeMount={beforeMount}
      onMount={onMount}
      options={EDITOR_OPTIONS}
      loading={<span className="font-mono text-xs text-fg-subtle">loading the editor…</span>}
    />
  );
}

/** Both panels reach the TypeScript worker through this. */
function createHandle(monaco: Monaco): EditorHandle {
  const client = async () => {
    const uri = monaco.Uri.parse(FILE_URI);
    const getWorker = await monaco.languages.typescript.getTypeScriptWorker();
    return { worker: await getWorker(uri), uri };
  };

  return {
    async transpile(source) {
      try {
        const { worker, uri } = await client();
        const output = await worker.getEmitOutput(uri.toString());
        return output.outputFiles[0]?.text ?? source;
      } catch {
        // plain-JS snippets still run: the worker strips the import itself
        return source;
      }
    },
    async firstDiagnostic() {
      try {
        const { worker, uri } = await client();
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
