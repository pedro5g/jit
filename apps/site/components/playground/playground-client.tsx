"use client";

import Editor, { type Monaco } from "@monaco-editor/react";
import { Play, Share2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useCopy } from "@/hooks/use-copy";
import type { PlaygroundOp, PlaygroundResponse } from "@/lib/playground/worker";

const RUN_TIMEOUT_MS = 2500;

const defaultCode = `import { JIT } from "@pedro5g/jit/runtime";

const schema = JIT.object({
  id: JIT.number().int().positive(),
  name: JIT.string().min(2),
  email: JIT.string().email().pii("mask"),
  role: JIT.union(JIT.literal("admin"), JIT.literal("user")),
  tags: JIT.array(JIT.string()).max(8),
});

// full type inference — hover User:
type User = JIT.Infer<typeof schema>;
`;

const adaInput = `{
  "id": 1,
  "name": "Ada",
  "email": "ada@lovelace.dev",
  "role": "admin",
  "tags": ["compiler"]
}`;

interface OpConfig {
  id: PlaygroundOp;
  label: string;
  needsB: false | { label: string; default: string };
  hasSource: boolean;
}

const ops: OpConfig[] = [
  { id: "validate", label: "validate", needsB: false, hasSource: true },
  { id: "parse", label: "parse", needsB: false, hasSource: true },
  { id: "equal", label: "equal", needsB: { label: "value B", default: adaInput }, hasSource: true },
  { id: "clone", label: "clone", needsB: false, hasSource: true },
  {
    id: "diff",
    label: "diff",
    needsB: {
      label: "value B",
      default: `{
  "id": 1,
  "name": "Ada L.",
  "email": "ada@lovelace.dev",
  "role": "admin",
  "tags": ["compiler", "math"]
}`,
    },
    hasSource: true,
  },
  { id: "hash", label: "hash", needsB: false, hasSource: true },
  { id: "update", label: "update", needsB: { label: "patch", default: `{ "name": "Grace" }` }, hasSource: false },
  { id: "stringify", label: "stringify", needsB: false, hasSource: true },
  { id: "mask", label: "mask", needsB: false, hasSource: false },
  { id: "sanitize", label: "sanitize", needsB: false, hasSource: false },
  { id: "codec", label: "codec", needsB: false, hasSource: false },
];

const examples: { id: string; label: string; code: string; a: string; op: PlaygroundOp }[] = [
  { id: "user", label: "User validator", code: defaultCode, a: adaInput, op: "validate" },
  {
    id: "invalid",
    label: "Invalid input (issues)",
    code: defaultCode,
    a: `{
  "id": -3,
  "name": "A",
  "email": "not-an-email",
  "role": "root",
  "tags": [42]
}`,
    op: "validate",
  },
  {
    id: "coerce",
    label: "Coercion & defaults",
    code: `import { JIT } from "@pedro5g/jit/runtime";

const schema = JIT.object({
  page: JIT.coerce.number().int().min(1).default(1),
  limit: JIT.coerce.number().int().max(100).default(20),
  search: JIT.string().trim().optional(),
});
`,
    a: `{ "page": "2", "limit": "50", "search": "  ghosts  " }`,
    op: "parse",
  },
  {
    id: "pii",
    label: "PII masking",
    code: defaultCode,
    a: adaInput,
    op: "mask",
  },
  {
    id: "codec",
    label: "Binary codec (wire v2)",
    code: defaultCode,
    a: adaInput,
    op: "codec",
  },
];

type RunState =
  | { status: "idle" }
  | { status: "running" }
  | { status: "done"; response: PlaygroundResponse }
  | { status: "error"; message: string };

interface SharePayload {
  code: string;
  a: string;
  b: string;
  op: PlaygroundOp;
}

function encodeShare(payload: SharePayload): string {
  return btoa(unescape(encodeURIComponent(JSON.stringify(payload))));
}

function decodeShare(hash: string): SharePayload | null {
  try {
    const parsed = JSON.parse(decodeURIComponent(escape(atob(hash))));
    if (typeof parsed.code === "string" && typeof parsed.a === "string") return parsed;
  } catch {
    // corrupt or foreign hash — fall back to defaults
  }
  return null;
}

const editorOptions = {
  minimap: { enabled: false },
  fontSize: 13,
  lineHeight: 21,
  scrollBeyondLastLine: false,
  padding: { top: 12, bottom: 12 },
  tabSize: 2,
  automaticLayout: true,
  wordWrap: "on",
  scrollbar: { verticalScrollbarSize: 8, horizontalScrollbarSize: 8 },
  renderLineHighlight: "none",
  overviewRulerLanes: 0,
  fixedOverflowWidgets: true,
} as const;

export function PlaygroundClient() {
  const [code, setCode] = useState(defaultCode);
  const [inputA, setInputA] = useState(adaInput);
  const [inputB, setInputB] = useState("");
  const [op, setOp] = useState<PlaygroundOp>("validate");
  const [run, setRun] = useState<RunState>({ status: "idle" });
  const [tab, setTab] = useState<"result" | "source">("result");
  const [dts, setDts] = useState<Record<string, string> | null>(null);

  const workerRef = useRef<Worker | null>(null);
  const monacoRef = useRef<Monaco | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const runId = useRef(0);
  const ranOnce = useRef(false);
  const editedB = useRef(false);
  const { copied, copyToClipboard } = useCopy();

  const opConfig = ops.find((item) => item.id === op) ?? ops[0];

  useEffect(() => {
    const shared = window.location.hash.startsWith("#code=")
      ? decodeShare(window.location.hash.slice("#code=".length))
      : null;
    if (shared) {
      setCode(shared.code);
      setInputA(shared.a);
      setInputB(shared.b ?? "");
      if (ops.some((item) => item.id === shared.op)) setOp(shared.op);
      editedB.current = true;
    }

    fetch("/playground/jit-dts.json")
      .then((response) => (response.ok ? response.json() : null))
      .then((manifest) => setDts(manifest?.files ?? {}))
      .catch(() => setDts({}));

    return () => {
      workerRef.current?.terminate();
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, []);

  const beforeMount = useCallback(
    (monaco: Monaco) => {
      monaco.editor.defineTheme("jit-night", {
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

      const ts = monaco.languages.typescript;
      ts.typescriptDefaults.setCompilerOptions({
        target: ts.ScriptTarget.ESNext,
        module: ts.ModuleKind.ESNext,
        moduleResolution: ts.ModuleResolutionKind.NodeJs,
        strict: true,
        esModuleInterop: true,
        allowNonTsExtensions: true,
      });
      ts.typescriptDefaults.setEagerModelSync(true);
      if (dts) {
        for (const [path, content] of Object.entries(dts)) {
          ts.typescriptDefaults.addExtraLib(content, `file:///node_modules/jit/${path}`);
        }
      }
    },
    [dts]
  );

  /** TS → JS via monaco's own TypeScript worker, so type aliases and generics run fine. */
  const transpile = useCallback(async (source: string): Promise<string> => {
    const monaco = monacoRef.current;
    if (!monaco) return source;
    try {
      const uri = monaco.Uri.parse("file:///playground/main.ts");
      const getWorker = await monaco.languages.typescript.getTypeScriptWorker();
      const client = await getWorker(uri);
      const output = await client.getEmitOutput(uri.toString());
      return output.outputFiles[0]?.text ?? source;
    } catch {
      return source; // plain-JS snippets still work — the worker strips imports
    }
  }, []);

  const execute = useCallback(
    async (request: { code: string; a: string; b: string; op: PlaygroundOp }) => {
      runId.current += 1;
      const id = runId.current;
      setRun({ status: "running" });

      const js = await transpile(request.code);

      if (!workerRef.current) {
        workerRef.current = new Worker(new URL("../../lib/playground/worker.ts", import.meta.url));
      }
      const worker = workerRef.current;

      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      timeoutRef.current = setTimeout(() => {
        worker.terminate();
        workerRef.current = null;
        setRun({ status: "error", message: `timed out after ${RUN_TIMEOUT_MS}ms — the worker was terminated` });
      }, RUN_TIMEOUT_MS);

      worker.onmessage = (event: MessageEvent<PlaygroundResponse>) => {
        if (event.data.id !== id) return;
        if (timeoutRef.current) clearTimeout(timeoutRef.current);
        ranOnce.current = true;
        setRun({ status: "done", response: event.data });
      };
      worker.onerror = () => {
        if (timeoutRef.current) clearTimeout(timeoutRef.current);
        worker.terminate();
        workerRef.current = null;
        setRun({ status: "error", message: "the worker crashed — check your snippet for syntax errors" });
      };

      worker.postMessage({ id, code: js, op: request.op, inputA: request.a, inputB: request.b });
    },
    [transpile]
  );

  const selectOp = (next: OpConfig) => {
    setOp(next.id);
    let nextB = inputB;
    if (next.needsB && !editedB.current) {
      nextB = next.needsB.default;
      setInputB(nextB);
    }
    if (!next.hasSource) setTab("result");
    if (ranOnce.current) execute({ code, a: inputA, b: next.needsB ? nextB : "", op: next.id });
  };

  const response = run.status === "done" ? run.response : null;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center gap-2">
        <label htmlFor="playground-example" className="text-xs text-fg-subtle">
          Example
        </label>
        <select
          id="playground-example"
          className="rounded-control border border-line-subtle bg-night-950 px-3 py-1.5 text-sm text-ghost-100"
          defaultValue="user"
          onChange={(event) => {
            const example = examples.find((item) => item.id === event.target.value);
            if (!example) return;
            setCode(example.code);
            setInputA(example.a);
            setInputB("");
            editedB.current = false;
            const config = ops.find((item) => item.id === example.op);
            if (config?.needsB) setInputB(config.needsB.default);
            setOp(example.op);
            setRun({ status: "idle" });
            ranOnce.current = false;
          }}
        >
          {examples.map((example) => (
            <option key={example.id} value={example.id}>
              {example.label}
            </option>
          ))}
        </select>
        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            onClick={() => {
              const url = `${window.location.origin}/playground#code=${encodeShare({ code, a: inputA, b: inputB, op })}`;
              copyToClipboard(url);
            }}
            className="inline-flex items-center gap-1.5 rounded-control border border-line-subtle px-3 py-1.5 text-xs text-fg-muted hover:border-line hover:text-ghost-100"
          >
            <Share2 aria-hidden className="size-3.5" />
            {copied ? "URL copied!" : "Share"}
          </button>
          <button
            type="button"
            onClick={() => execute({ code, a: inputA, b: opConfig.needsB ? inputB : "", op })}
            disabled={run.status === "running"}
            className="inline-flex items-center gap-1.5 rounded-control bg-gold-200 px-4 py-1.5 text-xs font-semibold text-night-900 hover:bg-gold-100 disabled:opacity-60"
          >
            <Play aria-hidden className="size-3.5" />
            {run.status === "running" ? "Compiling…" : "Compile & run"}
          </button>
        </div>
      </div>

      <div role="tablist" aria-label="Operation" className="flex flex-wrap gap-1.5">
        {ops.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={op === item.id}
            onClick={() => selectOp(item)}
            className={
              op === item.id
                ? "rounded-control bg-gold-200 px-3 py-1.5 font-mono text-xs text-night-900"
                : "rounded-control border border-line-subtle px-3 py-1.5 font-mono text-xs text-fg-muted hover:border-line hover:text-ghost-100"
            }
          >
            .{item.label}
          </button>
        ))}
      </div>

      <div className="grid gap-5 lg:grid-cols-[7fr_5fr]">
        <div className="flex flex-col gap-4">
          <div className="overflow-hidden rounded-card border border-line-subtle">
            {dts ? (
              <Editor
                height="380px"
                path="file:///playground/main.ts"
                defaultLanguage="typescript"
                theme="jit-night"
                value={code}
                onChange={(value) => setCode(value ?? "")}
                beforeMount={beforeMount}
                onMount={(_editor, monaco) => {
                  monacoRef.current = monaco;
                }}
                options={editorOptions}
                loading={
                  <div className="flex h-95 w-full items-center justify-center bg-night-950 font-mono text-xs text-fg-subtle">
                    loading editor…
                  </div>
                }
              />
            ) : (
              <div className="flex h-95 w-full items-center justify-center bg-night-950 font-mono text-xs text-fg-subtle">
                loading jit type definitions…
              </div>
            )}
          </div>
          <div className={opConfig.needsB ? "grid gap-4 sm:grid-cols-2" : "grid gap-4"}>
            <div>
              <label htmlFor="playground-input-a" className="mb-1.5 block font-mono text-xs text-fg-subtle">
                input A (JSON)
              </label>
              <textarea
                id="playground-input-a"
                value={inputA}
                onChange={(event) => setInputA(event.target.value)}
                spellCheck={false}
                rows={7}
                className="w-full resize-y rounded-card border border-line-subtle bg-night-950 p-4 font-mono text-[13px] leading-relaxed text-ghost-100 focus-visible:outline-2 focus-visible:outline-gold-200"
              />
            </div>
            {opConfig.needsB && (
              <div>
                <label htmlFor="playground-input-b" className="mb-1.5 block font-mono text-xs text-fg-subtle">
                  {opConfig.needsB.label} (JSON)
                </label>
                <textarea
                  id="playground-input-b"
                  value={inputB}
                  onChange={(event) => {
                    editedB.current = true;
                    setInputB(event.target.value);
                  }}
                  spellCheck={false}
                  rows={7}
                  className="w-full resize-y rounded-card border border-line-subtle bg-night-950 p-4 font-mono text-[13px] leading-relaxed text-ghost-100 focus-visible:outline-2 focus-visible:outline-gold-200"
                />
              </div>
            )}
          </div>
        </div>

        <div className="flex flex-col gap-3">
          <div role="tablist" aria-label="Playground output" className="flex gap-1.5">
            {(
              [
                { id: "result", label: "result" },
                { id: "source", label: "generated source" },
              ] as const
            ).map((item) => (
              <button
                key={item.id}
                type="button"
                role="tab"
                aria-selected={tab === item.id}
                disabled={item.id === "source" && !opConfig.hasSource}
                onClick={() => setTab(item.id)}
                className={
                  tab === item.id
                    ? "rounded-control bg-gold-200 px-3.5 py-1.5 font-mono text-xs text-night-900"
                    : "rounded-control border border-line-subtle px-3.5 py-1.5 font-mono text-xs text-fg-muted hover:text-ghost-100 disabled:cursor-not-allowed disabled:opacity-40"
                }
              >
                {item.label}
              </button>
            ))}
          </div>

          <div className="min-h-95 flex-1 overflow-hidden rounded-card border border-line-subtle bg-night-950">
            {tab === "source" && response?.ok && response.source ? (
              <Editor
                height="380px"
                defaultLanguage="javascript"
                theme="jit-night"
                value={response.source}
                options={{ ...editorOptions, readOnly: true, lineNumbers: "off" }}
              />
            ) : (
              <div className="h-full overflow-auto p-4">
                {run.status === "idle" && (
                  <p className="font-mono text-sm text-fg-subtle">
                    Pick an operation and press “Compile &amp; run” — everything executes locally in a Web Worker.
                  </p>
                )}
                {run.status === "running" && <p className="font-mono text-sm text-gold-200">compiling…</p>}
                {run.status === "error" && <p className="font-mono text-sm text-danger">{run.message}</p>}
                {response && !response.ok && <p className="font-mono text-sm text-danger">{response.error}</p>}
                {response?.ok && tab === "source" && !response.source && (
                  <p className="font-mono text-sm text-fg-subtle">
                    this operation does not expose its generated source (yet)
                  </p>
                )}
                {response?.ok && tab === "result" && (
                  <pre className="whitespace-pre-wrap wrap-break-word font-mono text-[13px] leading-relaxed text-ghost-100">
                    {response.result}
                  </pre>
                )}
              </div>
            )}
          </div>

          {response?.ok && (
            <p className="font-mono text-[11px] text-fg-subtle">
              compiled in {response.compileMs.toFixed(2)} ms · ran in {response.runMs.toFixed(3)} ms
            </p>
          )}
          <p className="text-xs leading-relaxed text-fg-subtle">
            Your code never leaves this tab: it runs in a terminable Web Worker via{" "}
            <span className="font-mono">globalThis.Function</span>, is never sent to a server and is never logged.
          </p>
        </div>
      </div>
    </div>
  );
}
