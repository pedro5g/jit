"use client";

import { Play, Share2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useCopy } from "@/hooks/use-copy";
import type { PlaygroundResponse } from "@/lib/playground/worker";

const RUN_TIMEOUT_MS = 2500;

const defaultCode = `const schema = JIT.object({
  id: JIT.number().int().positive(),
  name: JIT.string().min(2),
  email: JIT.string().email(),
  role: JIT.union(JIT.literal("admin"), JIT.literal("user")),
  tags: JIT.array(JIT.string()).max(8),
});`;

const defaultInput = `{
  "id": 1,
  "name": "Ada",
  "email": "ada@lovelace.dev",
  "role": "admin",
  "tags": ["compiler"]
}`;

const examples: { id: string; label: string; code: string; input: string }[] = [
  { id: "user", label: "User validator", code: defaultCode, input: defaultInput },
  {
    id: "invalid",
    label: "Invalid input (issues)",
    code: defaultCode,
    input: `{
  "id": -3,
  "name": "A",
  "email": "not-an-email",
  "role": "root",
  "tags": [42]
}`,
  },
  {
    id: "coerce",
    label: "Coercion & defaults",
    code: `const schema = JIT.object({
  page: JIT.coerce.number().int().min(1).default(1),
  limit: JIT.coerce.number().int().max(100).default(20),
  search: JIT.string().trim().optional(),
});`,
    input: `{ "page": "2", "limit": "50", "search": "  ghosts  " }`,
  },
];

type RunState =
  | { status: "idle" }
  | { status: "running" }
  | { status: "done"; response: PlaygroundResponse; elapsedMs: number }
  | { status: "error"; message: string };

function encodeShare(code: string, input: string): string {
  return btoa(unescape(encodeURIComponent(JSON.stringify({ code, input }))));
}

function decodeShare(hash: string): { code: string; input: string } | null {
  try {
    const parsed = JSON.parse(decodeURIComponent(escape(atob(hash))));
    if (typeof parsed.code === "string" && typeof parsed.input === "string") return parsed;
  } catch {
    // corrupt or foreign hash — fall through to defaults
  }
  return null;
}

export function PlaygroundClient() {
  const [code, setCode] = useState(defaultCode);
  const [input, setInput] = useState(defaultInput);
  const [run, setRun] = useState<RunState>({ status: "idle" });
  const [tab, setTab] = useState<"result" | "source">("result");
  const workerRef = useRef<Worker | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const runId = useRef(0);
  const { copied, copyToClipboard } = useCopy();

  useEffect(() => {
    const shared = window.location.hash.startsWith("#code=")
      ? decodeShare(window.location.hash.slice("#code=".length))
      : null;
    if (shared) {
      setCode(shared.code);
      setInput(shared.input);
    }
    return () => {
      workerRef.current?.terminate();
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, []);

  const execute = useCallback((nextCode: string, nextInput: string) => {
    runId.current += 1;
    const id = runId.current;
    setRun({ status: "running" });

    if (!workerRef.current) {
      workerRef.current = new Worker(new URL("../../lib/playground/worker.ts", import.meta.url));
    }
    const worker = workerRef.current;
    const startedAt = performance.now();

    timeoutRef.current = setTimeout(() => {
      worker.terminate();
      workerRef.current = null;
      setRun({ status: "error", message: `timed out after ${RUN_TIMEOUT_MS}ms — the worker was terminated` });
    }, RUN_TIMEOUT_MS);

    worker.onmessage = (event: MessageEvent<PlaygroundResponse>) => {
      if (event.data.id !== id) return;
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      setRun({ status: "done", response: event.data, elapsedMs: performance.now() - startedAt });
    };
    worker.onerror = () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      worker.terminate();
      workerRef.current = null;
      setRun({ status: "error", message: "the worker crashed — check your snippet for syntax errors" });
    };

    worker.postMessage({ id, code: nextCode, input: nextInput });
  }, []);

  const response = run.status === "done" ? run.response : null;

  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <div className="flex flex-col gap-4">
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
              if (example) {
                setCode(example.code);
                setInput(example.input);
                setRun({ status: "idle" });
              }
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
                const url = `${window.location.origin}/playground#code=${encodeShare(code, input)}`;
                copyToClipboard(url);
              }}
              className="inline-flex items-center gap-1.5 rounded-control border border-line-subtle px-3 py-1.5 text-xs text-fg-muted hover:border-line hover:text-ghost-100"
            >
              <Share2 aria-hidden className="size-3.5" />
              {copied ? "URL copied!" : "Share"}
            </button>
            <button
              type="button"
              onClick={() => execute(code, input)}
              disabled={run.status === "running"}
              className="inline-flex items-center gap-1.5 rounded-control bg-gold-200 px-4 py-1.5 text-xs font-semibold text-night-900 hover:bg-gold-100 disabled:opacity-60"
            >
              <Play aria-hidden className="size-3.5" />
              {run.status === "running" ? "Compiling…" : "Compile & run"}
            </button>
          </div>
        </div>

        <div>
          <label htmlFor="playground-code" className="mb-1.5 block font-mono text-xs text-fg-subtle">
            schema.js — plain JavaScript, JIT is in scope, define a <span className="text-gold-200">schema</span>
          </label>
          <textarea
            id="playground-code"
            value={code}
            onChange={(event) => setCode(event.target.value)}
            spellCheck={false}
            rows={12}
            className="w-full resize-y rounded-card border border-line-subtle bg-night-950 p-4 font-mono text-[13px] leading-relaxed text-ghost-100 focus-visible:outline-2 focus-visible:outline-gold-200"
          />
        </div>

        <div>
          <label htmlFor="playground-input" className="mb-1.5 block font-mono text-xs text-fg-subtle">
            input.json — validated with safeParse
          </label>
          <textarea
            id="playground-input"
            value={input}
            onChange={(event) => setInput(event.target.value)}
            spellCheck={false}
            rows={7}
            className="w-full resize-y rounded-card border border-line-subtle bg-night-950 p-4 font-mono text-[13px] leading-relaxed text-ghost-100 focus-visible:outline-2 focus-visible:outline-gold-200"
          />
        </div>
      </div>

      <div className="flex flex-col gap-3">
        <div role="tablist" aria-label="Playground output" className="flex gap-1.5">
          {(
            [
              { id: "result", label: "safeParse result" },
              { id: "source", label: "generated is() source" },
            ] as const
          ).map((item) => (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={tab === item.id}
              onClick={() => setTab(item.id)}
              className={
                tab === item.id
                  ? "rounded-control bg-gold-200 px-3.5 py-1.5 font-mono text-xs text-night-900"
                  : "rounded-control border border-line-subtle px-3.5 py-1.5 font-mono text-xs text-fg-muted hover:text-ghost-100"
              }
            >
              {item.label}
            </button>
          ))}
        </div>

        <div className="min-h-90 flex-1 overflow-auto rounded-card border border-line-subtle bg-night-950 p-4">
          {run.status === "idle" && (
            <p className="font-mono text-sm text-fg-subtle">
              Press “Compile &amp; run” — everything executes locally in a Web Worker.
            </p>
          )}
          {run.status === "running" && <p className="font-mono text-sm text-gold-200">compiling…</p>}
          {run.status === "error" && <p className="font-mono text-sm text-danger">{run.message}</p>}
          {response && !response.ok && <p className="font-mono text-sm text-danger">{response.error}</p>}
          {response?.ok && (
            <pre className="whitespace-pre-wrap font-mono text-[13px] leading-relaxed text-ghost-100">
              {tab === "result"
                ? response.result === null
                  ? "// no input provided — schema compiled successfully"
                  : JSON.stringify(response.result, null, 2)
                : response.source}
            </pre>
          )}
        </div>

        {response?.ok && (
          <p className="font-mono text-[11px] text-fg-subtle">
            compiled in {response.compileMs.toFixed(2)} ms · validated in {response.validateMs.toFixed(3)} ms · source
            hash <span className="text-ghost-300">{response.hash.slice(0, 12)}</span>
          </p>
        )}
        <p className="text-xs leading-relaxed text-fg-subtle">
          Your code never leaves this tab: it runs in a terminable Web Worker via{" "}
          <span className="font-mono">globalThis.Function</span>, is never sent to a server and is never logged.
        </p>
      </div>
    </div>
  );
}
