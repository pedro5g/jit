"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { ContextService } from "@/lib/copilot/application/context/context.service";
import { GENERATION_MODELS, type GenerationModelSpec } from "@/lib/copilot/config/models";
import type { RunArtifacts } from "@/lib/copilot/eval/artifacts";
import { type BrowserBlock, readBrowserEnvironment, usedHeapMb } from "@/lib/copilot/eval/browser-environment";
import { runBrowserBenchmark } from "@/lib/copilot/eval/browser-run";
import { bundleFileName, packBundle } from "@/lib/copilot/eval/bundle";
import { measureGeneration } from "@/lib/copilot/eval/detectors";
import { generationCases } from "@/lib/copilot/eval/generation-cases";
import { BROWSER_NOTE, renderReport } from "@/lib/copilot/eval/report";
import { createKnowledgeEngine, type KnowledgeEngine } from "@/lib/copilot/infrastructure/knowledge-engine";
import { TransformersLanguageModel } from "@/lib/copilot/infrastructure/models/transformers-language-model";
import { CopilotWorkerHost } from "@/lib/copilot/infrastructure/models/worker-host";
import { FetchArtifactLoader } from "@/lib/copilot/infrastructure/storage/fetch-artifact-loader";

/**
 * The browser half of the benchmark — §PART 26.
 *
 * Deliberately not linked from anywhere. This page is a measuring instrument,
 * not a feature: it downloads a model, answers thirty questions with it and
 * hands back a file. Everything that decides a number comes from the same
 * modules the headless run and the product use, so what is left here is the
 * three things a page genuinely owns — consent to a download, progress while
 * it runs, and the file at the end.
 *
 * The first run is manual on purpose. One browser, one machine, recorded
 * honestly is worth more than an automated harness measuring a headless Chrome
 * that no reader uses.
 */

interface Row {
  index: number;
  question: string;
  category: string;
  locale: string;
  latencyMs?: number;
  ttftMs?: number;
  flags?: string;
}

type Phase = "idle" | "loading" | "downloading" | "running" | "done" | "error";

const CASES = generationCases();

function formatMb(bytes: number) {
  return `${Math.round(bytes / (1024 * 1024))} MB`;
}

export function CopilotBenchmarkRunner() {
  const [spec, setSpec] = useState<GenerationModelSpec>(
    () => GENERATION_MODELS.find((model) => model.tier === "light") ?? GENERATION_MODELS[0]
  );
  const [limit, setLimit] = useState<number>(CASES.length);
  const [phase, setPhase] = useState<Phase>("idle");
  const [note, setNote] = useState<string>("");
  const [bytes, setBytes] = useState(0);
  const [rows, setRows] = useState<Row[]>([]);
  const [artifacts, setArtifacts] = useState<RunArtifacts | null>(null);
  const [report, setReport] = useState<string>("");
  const [error, setError] = useState<string>("");

  const engineRef = useRef<KnowledgeEngine | null>(null);
  const hostRef = useRef<CopilotWorkerHost | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const running = phase === "loading" || phase === "downloading" || phase === "running";
  const cases = useMemo(() => CASES.slice(0, limit), [limit]);

  const start = useCallback(async () => {
    setError("");
    setRows([]);
    setArtifacts(null);
    setReport("");
    setBytes(0);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      setPhase("loading");
      setNote("loading the knowledge artifacts this site ships");

      // The published artifacts, not a benchmark-only copy: a run against a
      // different knowledge build is not a comparison, and the manifest hash
      // recorded below is what proves which one it was.
      const engine = (engineRef.current ??= await createKnowledgeEngine(new FetchArtifactLoader()));
      const contextService = new ContextService({
        knowledge: engine.knowledge,
        routes: engine.routes,
        symbols: engine.symbols,
      });

      const host = (hostRef.current ??= new CopilotWorkerHost());

      setPhase("downloading");
      setNote(`downloading ${spec.label} — about ${formatMb(spec.approximateBytes)}, cached after the first run`);
      await host.preloadGeneration(spec.repo, spec.dtype, setBytes);

      const environment: BrowserBlock = await readBrowserEnvironment();
      let peak = environment.peakMemoryMb ?? 0;

      setPhase("running");
      setNote(`${cases.length} cases · ${spec.label} · WebGPU`);

      const result = await runBrowserBenchmark({
        engine,
        contextService,
        model: new TransformersLanguageModel(host, spec),
        spec,
        browser: environment,
        cases,
        signal: controller.signal,
        onProgress: (progress) => {
          const heap = usedHeapMb();
          if (heap !== null && heap > peak) peak = heap;

          setRows((current) => {
            const row: Row = {
              index: progress.index,
              question: progress.case.question,
              category: progress.case.category,
              locale: progress.case.locale,
              ...(progress.measured
                ? {
                    latencyMs: progress.measured.latencyMs,
                    ...(progress.measured.ttftMs ? { ttftMs: progress.measured.ttftMs } : {}),
                    flags:
                      progress.measured.measurement.audit.findings
                        .filter((finding) => finding.severity === "fatal")
                        .map((finding) => finding.kind)
                        .join(" ") || "ok",
                  }
                : {}),
            };

            const next = [...current];
            next[progress.index] = row;
            return next;
          });
        },
      });

      if (peak > 0) result.artifacts.manifest.browser = { ...environment, peakMemoryMb: peak };

      setArtifacts(result.artifacts);
      setReport(
        renderReport(
          [
            {
              config: result.artifacts.manifest.config,
              label: result.artifacts.manifest.configLabel,
              manifest: result.artifacts.manifest,
              cases: result.measured,
              metrics: measureGeneration(result.measured),
            },
          ],
          {
            title: "Browser product benchmark — WebGPU",
            cases: result.measured.length,
            runtime: "greedy decoding · WebGPU · the tier a reader gets",
            notes: BROWSER_NOTE,
          }
        )
      );

      setPhase("done");
      setNote(
        controller.signal.aborted
          ? `stopped after ${result.measured.length} of ${cases.length} cases — the partial run is still a run`
          : `${result.measured.length} cases answered`
      );
    } catch (failure) {
      setPhase("error");
      setError(failure instanceof Error ? failure.message : String(failure));
    }
  }, [cases, spec]);

  const stop = useCallback(() => {
    abortRef.current?.abort();
    setNote("stopping after the current case");
  }, []);

  /**
   * A page cannot write a directory, so the run leaves as one envelope.
   *
   * `pnpm knowledge:import` unpacks it into `.eval/copilot/runs/<run-id>/`,
   * where it is the same four files every other run is made of.
   */
  const download = useCallback(() => {
    if (!artifacts) return;

    const blob = new Blob([JSON.stringify(packBundle(artifacts))], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");

    anchor.href = url;
    anchor.download = bundleFileName(artifacts.manifest);
    anchor.click();

    URL.revokeObjectURL(url);
  }, [artifacts]);

  const done = rows.filter((row) => row.latencyMs !== undefined).length;

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-6 py-12">
      <header className="flex flex-col gap-2">
        <h1 className="font-semibold text-fg-strong text-xl">Browser product benchmark</h1>
        <p className="max-w-2xl text-fg-muted text-sm">
          The same cases, context and detectors as the headless run, answered by the model a reader actually gets. Its
          numbers are a second report — they are never merged into the headless table.
        </p>
      </header>

      <section className="flex flex-wrap items-end gap-3 rounded-card border border-line-subtle p-4">
        <label className="flex flex-col gap-1 text-xs">
          <span className="text-fg-subtle">tier</span>
          <select
            value={spec.id}
            disabled={running}
            onChange={(event) =>
              setSpec(GENERATION_MODELS.find((model) => model.id === event.target.value) ?? GENERATION_MODELS[0])
            }
            className="rounded-control border border-line-subtle bg-surface-800 px-2 py-1.5 text-fg text-sm"
          >
            {GENERATION_MODELS.map((model) => (
              <option key={model.id} value={model.id}>
                {model.tier} · {model.label} · {formatMb(model.approximateBytes)}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1 text-xs">
          <span className="text-fg-subtle">cases</span>
          <input
            type="number"
            min={1}
            max={CASES.length}
            value={limit}
            disabled={running}
            onChange={(event) => setLimit(Math.min(CASES.length, Math.max(1, Number(event.target.value) || 1)))}
            className="w-24 rounded-control border border-line-subtle bg-surface-800 px-2 py-1.5 text-fg text-sm"
          />
        </label>

        <button
          type="button"
          onClick={running ? stop : start}
          className="rounded-control border border-line-gold/60 bg-gold-200/10 px-3 py-1.5 font-semibold text-gold-100 text-sm"
        >
          {running ? "stop" : "run the benchmark"}
        </button>

        {artifacts && artifacts.responses.length > 0 && (
          <button
            type="button"
            onClick={download}
            className="rounded-control border border-line-subtle px-3 py-1.5 text-fg text-sm"
          >
            download run
          </button>
        )}
      </section>

      {(note || error) && (
        <p className={`font-mono text-xs ${error ? "text-danger" : "text-fg-subtle"}`}>
          {error || note}
          {phase === "downloading" && bytes > 0 ? ` · ${formatMb(bytes)}` : ""}
          {phase === "running" ? ` · ${done}/${cases.length}` : ""}
        </p>
      )}

      {rows.length > 0 && (
        <div className="overflow-x-auto rounded-card border border-line-subtle">
          <table className="w-full text-left font-mono text-xs">
            <thead className="text-fg-subtle">
              <tr>
                <th className="px-3 py-2 font-normal">#</th>
                <th className="px-3 py-2 font-normal">question</th>
                <th className="px-3 py-2 font-normal">ttft</th>
                <th className="px-3 py-2 font-normal">total</th>
                <th className="px-3 py-2 font-normal">audit</th>
              </tr>
            </thead>
            <tbody className="text-fg-muted">
              {rows.map((row) => (
                <tr key={row.index} className="border-line-subtle border-t">
                  <td className="px-3 py-1.5 text-fg-subtle">{row.index + 1}</td>
                  <td className="max-w-md truncate px-3 py-1.5">
                    {row.question}
                    <span className="ml-2 text-fg-subtle">
                      {row.category} · {row.locale}
                    </span>
                  </td>
                  <td className="px-3 py-1.5">{row.ttftMs ? `${(row.ttftMs / 1000).toFixed(2)}s` : "—"}</td>
                  <td className="px-3 py-1.5">{row.latencyMs ? `${(row.latencyMs / 1000).toFixed(1)}s` : "…"}</td>
                  <td className={`px-3 py-1.5 ${row.flags && row.flags !== "ok" ? "text-warning" : ""}`}>
                    {row.flags ?? ""}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {report && (
        <pre className="overflow-x-auto rounded-card border border-line-subtle p-4 font-mono text-[11px] text-fg-muted">
          {report}
        </pre>
      )}
    </div>
  );
}
