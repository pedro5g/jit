"use client";

import { AlertTriangle, Check, Loader2, Play, Timer, Wand2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { CopyButton } from "@/components/code/copy-button";
import { Select } from "@/components/ui/select";
import type { PlaygroundOp, PlaygroundResponse } from "@/lib/playground/worker";
import { bundleUnits } from "@/lib/workspace/bundle";
import { DEFAULT_INPUT, OPERATIONS } from "@/lib/workspace/operations";
import { compilationOrder, type WorkspaceProject } from "@/lib/workspace/project";
import { PanelBody, PanelToolbar, Tab } from "./panel-parts";
import type { EditorHandle } from "./workspace-editor";

/** A runaway loop in a snippet must not take the tab with it. */
const RUN_TIMEOUT_MS = 2500;

type RunState =
  | { status: "idle" }
  | { status: "running" }
  | { status: "done"; response: PlaygroundResponse }
  | { status: "error"; message: string };

/**
 * Runs the file the reader is looking at against real values, in a worker that
 * can be terminated. Every operation the engine exposes is here, and the ones
 * that can show their generated source do.
 *
 * The file arrives linked to whatever it imports, so a schema composed out of
 * another file runs here exactly as it would in a repository.
 */
export function RunPanel({ project, editor }: { project: WorkspaceProject; editor: EditorHandle | null }) {
  const [op, setOp] = useState<PlaygroundOp>("validate");
  const [inputA, setInputA] = useState(DEFAULT_INPUT);
  const [inputB, setInputB] = useState("");
  const [state, setState] = useState<RunState>({ status: "idle" });
  const [tab, setTab] = useState<"result" | "source">("result");

  const workerRef = useRef<Worker | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const runId = useRef(0);
  const editedB = useRef(false);

  const config = OPERATIONS.find((item) => item.id === op) ?? OPERATIONS[0];

  useEffect(() => {
    return () => {
      workerRef.current?.terminate();
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, []);

  // each operation carries its own sample for the second input
  useEffect(() => {
    if (editedB.current) return;
    setInputB(config.needsB ? config.needsB.default : "");
  }, [config]);

  const run = useCallback(async () => {
    if (!editor) return;

    runId.current += 1;
    const id = runId.current;
    setState({ status: "running" });

    const units = compilationOrder(project, project.activePath);
    const js = bundleUnits(
      await Promise.all(
        units.map(async (unit) => ({ path: unit.path, code: await editor.transpile(unit.path, unit.source) }))
      )
    );

    workerRef.current ??= new Worker(new URL("../../lib/playground/worker.ts", import.meta.url));
    const worker = workerRef.current;

    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => {
      worker.terminate();
      workerRef.current = null;
      setState({ status: "error", message: `timed out after ${RUN_TIMEOUT_MS}ms — the worker was terminated` });
    }, RUN_TIMEOUT_MS);

    worker.onmessage = (event: MessageEvent<PlaygroundResponse>) => {
      if (event.data.id !== id) return;
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      setState({ status: "done", response: event.data });
    };
    worker.onerror = () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      setState({ status: "error", message: "the worker crashed while running this snippet" });
    };

    worker.postMessage({ id, code: js, op, inputA, inputB });
  }, [project, editor, inputA, inputB, op]);

  const inputProblem = jsonProblem(inputA);
  const response = state.status === "done" ? state.response : null;
  const source = response?.ok ? (response.source ?? "") : "";
  const failed = state.status === "error" || (response !== null && !response.ok);
  const output = tab === "source" ? source : response?.ok ? response.result : (response?.error ?? "");

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PanelToolbar>
        <div className="w-40">
          <Select
            ariaLabel="Operation to run"
            value={op}
            onValueChange={(value) => setOp(value as PlaygroundOp)}
            options={OPERATIONS.map((operation) => ({ value: operation.id, label: operation.label }))}
          />
        </div>
        <button
          type="button"
          onClick={() => void run()}
          disabled={!editor || state.status === "running"}
          className="inline-flex items-center gap-1.5 rounded-control border border-line-gold/50 bg-gold-200/10 px-3 py-1.5 text-xs font-semibold text-gold-200 transition-colors hover:bg-gold-200/20 disabled:opacity-40"
        >
          {state.status === "running" ? (
            <Loader2 aria-hidden className="size-3 animate-spin" />
          ) : (
            <Play aria-hidden className="size-3" />
          )}
          Run
        </button>
      </PanelToolbar>

      <PanelBody>
        {/* Input first, output under it, and the cost between the two: the
            timings are the whole claim the library makes, and they were being
            measured and thrown away. */}
        <Input
          label={config.aLabel ?? "value (JSON)"}
          value={inputA}
          rows={5}
          onChange={setInputA}
          problem={inputProblem}
          onFormat={() => setInputA(formatJson(inputA))}
        />

        {config.needsB && (
          <Input
            label={config.needsB.label}
            value={inputB}
            rows={4}
            onChange={(value) => {
              editedB.current = true;
              setInputB(value);
            }}
          />
        )}

        {response?.ok && (
          <dl className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-1 rounded-control border border-success/30 bg-success/5 px-3 py-2">
            <div className="flex items-center gap-1.5">
              <Check aria-hidden className="size-3 shrink-0 text-success" />
              <dt className="font-mono text-[10px] uppercase tracking-wide text-fg-subtle">compiled</dt>
              <dd className="font-mono text-[12px] text-ghost-100">{response.compileMs.toFixed(2)} ms</dd>
              <span className="text-[10px] text-fg-subtle">once, then cached</span>
            </div>
            <div className="flex items-center gap-1.5">
              <Timer aria-hidden className="size-3 shrink-0 text-gold-200" />
              <dt className="font-mono text-[10px] uppercase tracking-wide text-fg-subtle">ran</dt>
              <dd className="font-mono text-[12px] text-ghost-100">{response.runMs.toFixed(3)} ms</dd>
              <span className="text-[10px] text-fg-subtle">every call after that</span>
            </div>
          </dl>
        )}

        <div className="flex min-h-0 flex-1 flex-col">
          <div className="flex items-center gap-1 border-b border-line-subtle">
            <Tab active={tab === "result"} onClick={() => setTab("result")} label="result" />
            {config.hasSource && (
              <Tab active={tab === "source"} onClick={() => setTab("source")} label="generated source" />
            )}
            {output && (
              <span className="ml-auto pb-1">
                <CopyButton text={output} label="Copy the output" />
              </span>
            )}
          </div>

          <pre
            className={`mt-2 min-h-32 flex-1 overflow-auto rounded-control border p-3 font-mono text-[12px] leading-relaxed ${
              failed ? "border-danger/40 bg-danger/5 text-danger" : "border-line-subtle bg-night-1000/60 text-ghost-100"
            }`}
          >
            <code>
              {state.status === "idle" ? (
                <span className="text-fg-subtle">
                  Run the schema to see the result, and the exact source jit generates for it.
                </span>
              ) : state.status === "running" ? (
                <span className="text-fg-subtle">running…</span>
              ) : state.status === "error" ? (
                state.message
              ) : (
                output || "(no output)"
              )}
            </code>
          </pre>
        </div>
      </PanelBody>
    </div>
  );
}

function Input({
  label,
  value,
  rows,
  onChange,
  problem,
  onFormat,
}: {
  label: string;
  value: string;
  rows: number;
  onChange: (value: string) => void;
  /** Set when the text is not the JSON it claims to be. */
  problem?: string | null;
  onFormat?: () => void;
}) {
  return (
    <label className="flex shrink-0 flex-col gap-1.5">
      <span className="flex items-center gap-2">
        <span className="font-mono text-[11px] uppercase tracking-wide text-fg-subtle">{label}</span>
        {problem ? (
          <span className="inline-flex items-center gap-1 font-mono text-[10px] text-warning">
            <AlertTriangle aria-hidden className="size-2.5" />
            {problem}
          </span>
        ) : (
          onFormat && (
            <button
              type="button"
              onClick={onFormat}
              className="ml-auto inline-flex items-center gap-1 font-mono text-[10px] text-fg-subtle transition-colors hover:text-gold-200"
            >
              <Wand2 aria-hidden className="size-2.5" />
              format
            </button>
          )
        )}
      </span>
      <textarea
        value={value}
        onChange={(event) => onChange(event.target.value)}
        rows={rows}
        spellCheck={false}
        className={`resize-y rounded-control border bg-night-1000/60 p-2.5 font-mono text-[12px] leading-relaxed text-fg outline-none transition-colors focus:border-line-gold ${
          problem ? "border-warning/50" : "border-line-subtle"
        }`}
      />
    </label>
  );
}

/** Says what is wrong with the value before the worker has to find out. */
function jsonProblem(value: string): string | null {
  if (!value.trim()) return null;

  try {
    JSON.parse(value);
    return null;
  } catch (error) {
    return error instanceof Error ? error.message.replace(/^JSON\.parse: /, "") : "not valid JSON";
  }
}

function formatJson(value: string): string {
  try {
    return JSON.stringify(JSON.parse(value), null, 2);
  } catch {
    return value;
  }
}
