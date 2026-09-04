"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { ContextService } from "@/lib/copilot/application/context/context.service";
import { QUALIFICATION_CANDIDATES } from "@/lib/copilot/config/models";
import type { RunArtifacts, RunManifest } from "@/lib/copilot/eval/artifacts";
import { type BrowserBlock, readBrowserEnvironment, usedHeapMb } from "@/lib/copilot/eval/browser-environment";
import { runBrowserCapabilityBenchmark, unavailableCapabilityRun } from "@/lib/copilot/eval/browser-run";
import { bundleFileName, packBundle } from "@/lib/copilot/eval/bundle";
import {
  type CapabilityConfig,
  type CapabilityRunResult,
  capabilityCases,
  decideCapabilityVerdict,
  fullCapabilityGate,
  smokeGate,
  summarizeCapability,
} from "@/lib/copilot/eval/capability";
import { type CapabilityReportSection, renderCapabilityReport } from "@/lib/copilot/eval/capability-report";
import { BrowserEmbedder } from "@/lib/copilot/infrastructure/embeddings/browser-embedder";
import { createKnowledgeEngine, type KnowledgeEngine } from "@/lib/copilot/infrastructure/knowledge-engine";
import {
  ChromeLanguageModel,
  chromeLanguageModelStatus,
} from "@/lib/copilot/infrastructure/models/chrome-language-model";
import { TransformersLanguageModel } from "@/lib/copilot/infrastructure/models/transformers-language-model";
import { CopilotWorkerHost } from "@/lib/copilot/infrastructure/models/worker-host";
import { FetchArtifactLoader } from "@/lib/copilot/infrastructure/storage/fetch-artifact-loader";

/**
 * The browser half of the benchmark — §PART 26.
 *
 * Deliberately not linked from anywhere. This page is a measuring instrument,
 * not a feature: it downloads a model, answers forty questions with it and
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

function formatMb(bytes: number | undefined) {
  return bytes === undefined ? "N/A" : `${Math.round(bytes / (1024 * 1024))} MB`;
}

function smokeGateFor(result: CapabilityRunResult) {
  const smokeQuestions = new Set(capabilityCases("smoke").map((testCase) => testCase.question));
  const smokeRows = result.measured.filter((row) => smokeQuestions.has(row.case.question));
  return smokeGate(smokeRows.length > 0 ? summarizeCapability(smokeRows) : result.metrics);
}

function orderError(
  results: Partial<Record<CapabilityConfig, CapabilityRunResult>>,
  config: CapabilityConfig,
  caseCount: number
): string | null {
  const p = results.P;
  if (config === "P") {
    if (caseCount <= 8) return null;
    if (p?.measured.length === caseCount && fullCapabilityGate(p.metrics).passed) return null;
    if (!p) return "run Config P smoke and clear its gate before the full run";
    if (p.measured.length !== 8) return "run Config P smoke and clear its gate before the full run";
    if (!smokeGateFor(p).passed) return "Config P did not clear the smoke gate; stop before the full run";
    return null;
  }

  if (!p || p.measured.length !== caseCount) {
    return `run Config P with the same ${caseCount} cases and clear its smoke gate before Config ${config}`;
  }
  if (!smokeGateFor(p).passed) return "Config P did not clear the smoke gate; do not continue to R/X";
  if (caseCount > 8 && !fullCapabilityGate(p.metrics).passed) {
    return "Config P did not clear the full capability gate; do not continue to full R/X";
  }
  if (config === "R") return null;

  const r = results.R;
  if (!r || r.measured.length !== caseCount) {
    return `run Config R with the same ${caseCount} cases and clear its smoke gate before Config X`;
  }
  if (!smokeGateFor(r).passed) return "Config R did not clear the smoke gate; do not continue to X";
  return null;
}

export function CopilotBenchmarkRunner() {
  const [candidateId, setCandidateId] = useState(QUALIFICATION_CANDIDATES[0]?.id ?? "");
  const candidate = useMemo(
    () => QUALIFICATION_CANDIDATES.find((entry) => entry.id === candidateId) ?? QUALIFICATION_CANDIDATES[0],
    [candidateId]
  );
  const [decodingId, setDecodingId] = useState(candidate?.decodings[0]?.id ?? "");
  const decoding = candidate?.decodings.find((entry) => entry.id === decodingId) ?? candidate?.decodings[0];
  const [config, setConfig] = useState<CapabilityConfig>("P");
  const [caseSet, setCaseSet] = useState<"smoke" | "full">("smoke");
  const [phase, setPhase] = useState<Phase>("idle");
  const [note, setNote] = useState<string>("");
  const [bytes, setBytes] = useState(0);
  const [rows, setRows] = useState<Row[]>([]);
  const [artifacts, setArtifacts] = useState<RunArtifacts | null>(null);
  const [report, setReport] = useState<string>("");
  const [error, setError] = useState<string>("");
  const [runResults, setRunResults] = useState<Partial<Record<CapabilityConfig, CapabilityRunResult>>>({});

  const engineRef = useRef<KnowledgeEngine | null>(null);
  const hostRef = useRef<CopilotWorkerHost | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const running = phase === "loading" || phase === "downloading" || phase === "running";
  const cases = useMemo(() => capabilityCases(caseSet), [caseSet]);

  const reportFor = useCallback(
    (results: Partial<Record<CapabilityConfig, CapabilityRunResult>>) => {
      const sections = (Object.entries(results) as [CapabilityConfig, CapabilityRunResult][]).map(
        ([entryConfig, result]): CapabilityReportSection => ({
          config: entryConfig,
          label: result.artifacts.manifest.configLabel,
          artifacts: result.artifacts,
          cases: result.measured,
          metrics: result.metrics,
          deliveredMetrics: result.deliveredMetrics,
          profile: result.profile,
        })
      );
      const p = results.P;
      let verdict = null;
      if (p) {
        const smokeQuestions = new Set(capabilityCases("smoke").map((testCase) => testCase.question));
        const smokeRows = p.measured.filter((row) => smokeQuestions.has(row.case.question));
        const smoke = smokeGate(smokeRows.length > 0 ? summarizeCapability(smokeRows) : p.metrics);
        const full = p.measured.length >= capabilityCases("full").length ? fullCapabilityGate(p.metrics) : undefined;
        verdict = decideCapabilityVerdict({ smoke, ...(full ? { full } : {}) });
      }
      return renderCapabilityReport(sections, { caseSet, verdict, includeHumanReview: true });
    },
    [caseSet]
  );

  const start = useCallback(async () => {
    const prerequisiteError = orderError(runResults, config, cases.length);
    if (prerequisiteError) {
      setError(prerequisiteError);
      return;
    }

    setError("");
    setRows([]);
    setArtifacts(null);
    setReport("");
    setBytes(0);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      if (!candidate) throw new Error("no qualification candidate is registered");
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

      const environment: BrowserBlock = await readBrowserEnvironment();
      let peak = environment.peakMemoryMb ?? 0;
      const host = (hostRef.current ??= new CopilotWorkerHost());

      const embedder =
        config === "P" || candidate.provider === "chrome-language-model" ? null : new BrowserEmbedder(host);
      if (embedder) {
        setNote("downloading the multilingual retrieval model");
        await embedder.preload(setBytes);
        // The capability candidate's bytes must not include the optional
        // retrieval model; reset before its own preparation starts.
        setBytes(0);
      }

      setPhase("downloading");
      let runtime: RunManifest["runtime"] = {
        provider: candidate.provider,
        device: candidate.provider === "chrome-language-model" ? "browser" : "webgpu",
        compatibility: "available",
      };
      let model: ChromeLanguageModel | TransformersLanguageModel;

      if (candidate.provider === "chrome-language-model") {
        const chrome = new ChromeLanguageModel();
        const status = await chromeLanguageModelStatus();
        if (status === "unsupported" || status === "unavailable") {
          const unavailable = unavailableCapabilityRun({
            engine,
            spec: candidate,
            browser: environment,
            config,
            availability: status,
            detail:
              status === "unsupported"
                ? "LanguageModel.availability() is not exposed."
                : "LanguageModel.availability() returned unavailable.",
          });
          setArtifacts(unavailable.artifacts);
          const nextResults = { ...runResults, [config]: unavailable };
          setRunResults(nextResults);
          setReport(reportFor(nextResults));
          setPhase("done");
          setNote("Chrome LanguageModel unavailable in this environment; recorded as infrastructure unavailable");
          return;
        }

        setNote(
          status === "needs-download" || status === "downloading"
            ? "preparing Chrome LanguageModel; the browser owns the model download"
            : "preparing the available Chrome LanguageModel"
        );
        const coldStart = performance.now();
        const prepared = await chrome.initialize((fraction) =>
          setNote(`Chrome model download ${Math.round(fraction * 100)}%`)
        );
        const coldStartMs = performance.now() - coldStart;
        if (prepared === "unsupported" || prepared === "unavailable") {
          const unavailable = unavailableCapabilityRun({
            engine,
            spec: candidate,
            browser: environment,
            config,
            availability: prepared,
            detail: chrome.lastAvailabilityDetail ?? `Chrome LanguageModel preparation returned ${prepared}.`,
          });
          setArtifacts(unavailable.artifacts);
          const nextResults = { ...runResults, [config]: unavailable };
          setRunResults(nextResults);
          setReport(reportFor(nextResults));
          setPhase("done");
          setNote(`Chrome LanguageModel ${prepared}; recorded as infrastructure unavailable`);
          return;
        }
        const warmStart = performance.now();
        await chrome.availability();
        runtime = {
          ...runtime,
          availability: "ready",
          coldStartMs,
          warmInitMs: performance.now() - warmStart,
          ...(chrome.lastSessionCreateMs !== undefined ? { sessionCreateMs: chrome.lastSessionCreateMs } : {}),
        };
        model = chrome;
      } else {
        const hasWebGpu = "gpu" in navigator;
        if (!hasWebGpu) {
          const unavailable = unavailableCapabilityRun({
            engine,
            spec: candidate,
            browser: environment,
            config,
            availability: "unsupported",
            detail: "navigator.gpu is not exposed in this browser.",
          });
          setArtifacts(unavailable.artifacts);
          const nextResults = { ...runResults, [config]: unavailable };
          setRunResults(nextResults);
          setReport(reportFor(nextResults));
          setPhase("done");
          setNote("WebGPU unavailable in this environment; recorded as infrastructure unavailable");
          return;
        }
        if (!candidate.model || !candidate.dtype)
          throw new Error(`${candidate.label} has no Transformers checkpoint or dtype`);
        setNote(
          `preparing ${candidate.label} — about ${formatMb(candidate.approximateBytes)}, cached after the first run`
        );
        let observedBytes = 0;
        const coldStart = performance.now();
        await host.preloadGeneration(candidate.model, candidate.dtype, (value) => {
          observedBytes = value;
          setBytes(value);
        });
        const coldStartMs = performance.now() - coldStart;
        const warmStart = performance.now();
        await host.preloadGeneration(candidate.model, candidate.dtype);
        runtime = {
          ...runtime,
          coldStartMs,
          warmInitMs: performance.now() - warmStart,
          ...(observedBytes > 0 ? { downloadBytes: observedBytes } : {}),
        };
        model = new TransformersLanguageModel(host, candidate);
      }

      setPhase("running");
      setNote(`${cases.length} ${caseSet} cases · config ${config} · ${candidate.label} · ${runtime.device}`);

      const result = await runBrowserCapabilityBenchmark({
        engine,
        contextService,
        model,
        embedder,
        spec: candidate,
        decoding,
        runtime,
        browser: environment,
        config,
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

      if (candidate.provider === "chrome-language-model" && model instanceof ChromeLanguageModel) {
        if (model.lastSessionCreateMs !== undefined) {
          result.artifacts.manifest.runtime.sessionCreateMs = model.lastSessionCreateMs;
        }
      }

      if (peak > 0) result.artifacts.manifest.browser = { ...environment, peakMemoryMb: peak };

      setArtifacts(result.artifacts);
      const nextResults = { ...runResults, [config]: result };
      setRunResults(nextResults);
      setReport(reportFor(nextResults));

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
  }, [candidate, cases, caseSet, config, decoding, reportFor, runResults]);

  const prerequisiteForCurrentSet = orderError(runResults, config, cases.length);

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
        <h1 className="font-semibold text-fg-strong text-xl">JIT Copilot model/runtime shootout</h1>
        <p className="max-w-2xl text-fg-muted text-sm">
          Same Config P task for every candidate: oracle evidence, minimal synthesis prompt, raw answer and shadow
          measurement. A candidate must pass the smoke gate before it can run the full set or proceed to R/X.
        </p>
      </header>

      <section className="flex flex-wrap items-end gap-3 rounded-card border border-line-subtle p-4">
        <label className="flex flex-col gap-1 text-xs">
          <span className="text-fg-subtle">candidate</span>
          <select
            value={candidateId}
            disabled={running}
            onChange={(event) => {
              const next = QUALIFICATION_CANDIDATES.find((entry) => entry.id === event.target.value);
              setCandidateId(event.target.value);
              setDecodingId(next?.decodings[0]?.id ?? "");
              setRunResults({});
              setRows([]);
              setReport("");
            }}
            className="rounded-control border border-line-subtle bg-surface-800 px-2 py-1.5 text-fg text-sm"
          >
            {QUALIFICATION_CANDIDATES.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.label}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1 text-xs">
          <span className="text-fg-subtle">config</span>
          <select
            value={config}
            disabled={running}
            onChange={(event) => setConfig(event.target.value as CapabilityConfig)}
            className="rounded-control border border-line-subtle bg-surface-800 px-2 py-1.5 text-fg text-sm"
          >
            <option value="P">P · oracle context</option>
            <option value="R" disabled={orderError(runResults, "R", cases.length) !== null}>
              R · real context, minimal prompt
            </option>
            <option value="X" disabled={orderError(runResults, "X", cases.length) !== null}>
              X · production
            </option>
          </select>
        </label>

        <label className="flex flex-col gap-1 text-xs">
          <span className="text-fg-subtle">decoding</span>
          <select
            value={decoding?.id ?? ""}
            disabled={running}
            onChange={(event) => {
              setDecodingId(event.target.value);
              setRunResults({});
              setRows([]);
              setReport("");
            }}
            className="rounded-control border border-line-subtle bg-surface-800 px-2 py-1.5 text-fg text-sm"
          >
            {candidate?.decodings.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.label}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1 text-xs">
          <span className="text-fg-subtle">case set</span>
          <select
            value={caseSet}
            disabled={running}
            onChange={(event) => setCaseSet(event.target.value as "smoke" | "full")}
            className="rounded-control border border-line-subtle bg-surface-800 px-2 py-1.5 text-fg text-sm"
          >
            <option value="smoke">smoke · 8 cases</option>
            <option value="full">full · 40 cases</option>
          </select>
        </label>

        <div className="flex flex-col gap-1 text-xs">
          <span className="text-fg-subtle">runtime / dtype</span>
          <span className="rounded-control border border-line-subtle px-2 py-1.5 text-fg text-sm">
            {candidate?.provider} · {candidate?.dtype ?? "N/A"}
          </span>
        </div>

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

      {!running && prerequisiteForCurrentSet && config !== "P" && !error && (
        <p className="font-mono text-fg-subtle text-xs">{prerequisiteForCurrentSet}</p>
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
