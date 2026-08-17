"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  type AssistantAction,
  codeActionFrom,
  demoActionFor,
  deriveActions,
  mergeActions,
  parseActions,
} from "@/lib/assistant/actions";
import { type AuditFinding, audit, isSevere } from "@/lib/assistant/audit";
import { GENERATION_MODELS, type GenerationModel } from "@/lib/assistant/catalog";
import { AssistantEngine } from "@/lib/assistant/engine";
import { describeFailure, mainExample, replaceMainExample } from "@/lib/assistant/example";
import { createExampleVerifier, type ExampleVerifier } from "@/lib/assistant/example-runner";
import { canAnswerFromGround, groundedAnswer, verifiedExampleFor } from "@/lib/assistant/grounded";
import { inspectModel, type ModelPresence } from "@/lib/assistant/model-store";
import { withRemainingTime } from "@/lib/assistant/progress";
import { followUpsFor } from "@/lib/assistant/prompt";
import { CancelledError } from "@/lib/assistant/providers/transformers";
import { betterAttempt, repairTurn } from "@/lib/assistant/repair";
import type { ModelStatus, ProviderState, RetrievedSection } from "@/lib/assistant/types";
import { groundTruth, mechanisms, type Understanding, understand } from "@/lib/assistant/understanding";

/**
 * Enough room for a short explanation plus a complete schema. A small model
 * rambles when given more, but running out mid-block is worse: the closing
 * fence never arrives, so the editor receives nothing at all.
 */
const MAX_ANSWER_TOKENS = 768;

/**
 * Turns of conversation sent to the model. The transcript on screen keeps
 * everything, but a 0.8B model has a small context window and the retrieved
 * sections have to fit in it — an unbounded history would push the documentation
 * out of the prompt, which is the one thing the answer cannot do without.
 */
const HISTORY_TURNS = 6;

/**
 * How many times a rejected answer is sent back to be rewritten.
 *
 * The audit knows exactly what was wrong, and the model is still loaded, so a
 * correction costs one more generation and nothing else. Two is where it stops
 * paying: a small model that has failed the same check twice is not converging,
 * and the reader is better served by the banner than by a third rewrite.
 */
const MAX_REPAIRS = 2;

/**
 * Characters between progress updates while the model writes. Small enough
 * that the counter never looks stuck, large enough that a 300-token answer
 * costs a handful of renders rather than one per token.
 */
const PROGRESS_STEP_CHARS = 48;

/** Said under an example that came from the docs rather than from the model. */
const VERIFIED_EXAMPLE_NOTE: Record<"pt" | "en", string> = {
  pt: "Este exemplo vem da documentação e é executado pela suíte de testes. Não consegui escrever um que funcionasse para a sua pergunta.",
  en: "This example comes from the documentation and is executed by the test suite. I could not write one of my own that ran.",
};

/** Findings that are about the code block rather than about the answer. */
function isAboutTheExample(finding: AuditFinding): boolean {
  return finding.kind === "example-failed" || finding.kind === "unusable-example";
}

/**
 * Where an answer is in the pipeline, for a reader watching it happen.
 *
 * This replaces watching the text itself arrive. A streamed draft is the
 * model's first attempt, and the first attempt is the one the audit most often
 * rejects: the reader would read a wrong answer, believe it, and then watch it
 * be replaced by a different one. Nothing about that sequence tells them which
 * of the two to trust. So the text stays hidden until it has been checked, and
 * what moves on screen is the work actually being done.
 */
export type AnswerStage =
  /** Ranking the documentation for the question. */
  | "reading"
  /** The model is generating. */
  | "writing"
  /** Checking names, figures and claims against the real library. */
  | "checking"
  /** Executing the example it wrote. */
  | "running"
  /** The check failed and the model is rewriting. */
  | "correcting";

/** Something the ghost did on its own, shown in the transcript after the answer. */
export interface PerformedAction {
  label: string;
  kind: AssistantAction["kind"];
  /** Present when the reader can put it back. */
  undo?: (() => void) | undefined;
}

export interface AssistantMessage {
  id: number;
  role: "user" | "assistant";
  content: string;
  sources: RetrievedSection[];
  actions: AssistantAction[];
  performed: PerformedAction[];
  followUps: string[];
  /** What the audit found wrong with the answer before it was shown. */
  findings: AuditFinding[];
  /** Set while the answer is still being produced and checked. */
  streaming?: boolean;
  /** What is happening right now, while `streaming` is set. */
  stage?: AnswerStage;
  /**
   * Characters the model has produced so far. The text stays hidden until it
   * has been checked, so this is what shows the reader it is still moving.
   */
  written?: number;
  /** How many rewrites it took, when it took any. */
  attempts?: number;
  error?: string;
}

export interface SemanticState {
  status: ModelStatus;
  progress: number;
}

export interface ModelChoice extends GenerationModel {
  presence: ModelPresence | null;
  selected: boolean;
}

export interface AskOptions {
  currentUrl: string;
  editorCode?: string | undefined;
  /**
   * Runs the actions the answer produced and reports both halves: what it did,
   * and what is left for the reader to click. Whether the ghost may navigate or
   * write depends on where the reader is — a decision the component owns, not
   * this hook — and the split is frozen here, because recomputing it later
   * would offer "take me there" from the page it already took them to.
   */
  perform?: (
    actions: AssistantAction[],
    context: PerformContext
  ) => { performed: PerformedAction[]; offered: AssistantAction[] };
}

/** What `perform` needs from the pipeline to decide how far it may go. */
export interface PerformContext {
  /** The reader asked to be taken somewhere, rather than asked a question. */
  asksToNavigate: boolean;
}

/** Without an executor every action stays a button, which is the safe default. */
function splitActions(
  result: { performed: PerformedAction[]; offered: AssistantAction[] } | undefined,
  fallback: AssistantAction[]
) {
  return { performed: result?.performed ?? [], actions: result?.offered ?? fallback };
}

/**
 * Owns one engine for the page and exposes it as state a component can render.
 * Nothing is created until the panel is first opened, and no model is ever
 * downloaded without the reader asking for it.
 */
export function useAssistant() {
  const engineRef = useRef<AssistantEngine | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const verifierRef = useRef<ExampleVerifier | null>(null);
  const nextId = useRef(1);
  /** What the last question turned out to be about, for continuity checks. */
  const lastUnderstanding = useRef<Understanding | null>(null);

  const [messages, setMessages] = useState<AssistantMessage[]>([]);
  const [indexError, setIndexError] = useState<string | null>(null);
  const [provider, setProvider] = useState<ProviderState | null>(null);
  const [models, setModels] = useState<ModelChoice[]>([]);
  const [semantic, setSemantic] = useState<SemanticState>({ status: "needs-download", progress: 0 });
  const [busy, setBusy] = useState(false);

  const engine = useCallback(() => {
    engineRef.current ??= new AssistantEngine();
    return engineRef.current;
  }, []);

  /** Created on the first answer that contains code, and reused after that. */
  const verifier = useCallback(() => {
    verifierRef.current ??= createExampleVerifier();
    return verifierRef.current;
  }, []);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
      engineRef.current?.dispose();
      verifierRef.current?.dispose();
    };
  }, []);

  /** Asks the cache what is already on this machine, for every offered model. */
  const refreshModels = useCallback(async () => {
    const selected = engine().selectedModel;

    const inspected = await Promise.all(
      GENERATION_MODELS.map(async (model) => ({
        ...model,
        presence: await inspectModel(model).catch(() => null),
        selected: model.id === selected.id,
      }))
    );

    setModels(inspected);
    return inspected;
  }, [engine]);

  const syncProvider = useCallback(async () => {
    const current = engine();
    const selected = current.selectProvider();

    if (!selected) {
      setProvider(null);
      return;
    }

    const status = await selected.availability();
    const local = selected.runtime === "webgpu-transformers" ? current.selectedModel : null;
    const presence = local ? await inspectModel(local).catch(() => null) : null;

    setProvider({
      runtime: selected.runtime,
      label: selected.label,
      modelId: local?.id,
      cachedBytes: presence?.cachedBytes,
      totalBytes: presence?.totalBytes,
      status,
      progress: status === "ready" ? 100 : 0,
    });
  }, [engine]);

  /** Loads the retrieval index and reports what this browser can run. */
  const initialize = useCallback(async () => {
    engine()
      .loadIndex()
      .then(() => setIndexError(null))
      .catch((error: Error) => setIndexError(error.message));

    await Promise.all([syncProvider(), refreshModels()]);
  }, [engine, syncProvider, refreshModels]);

  const selectModel = useCallback(
    async (model: GenerationModel) => {
      engine().selectModel(model);
      await Promise.all([syncProvider(), refreshModels()]);
    },
    [engine, syncProvider, refreshModels]
  );

  /** Downloads and warms the model the reader agreed to. */
  const prepareProvider = useCallback(async () => {
    const current = engine();
    // a reader who explicitly asks for the download wants the local model,
    // even on a browser that also has a built-in one
    const selected =
      current.selectProvider()?.runtime === "chrome-built-in" ? current.selectProvider() : current.localProvider();
    if (!selected) return;

    const startedAt = Date.now();
    setProvider((state) => (state ? { ...state, status: "downloading", progress: 0, error: undefined } : state));

    try {
      await selected.prepare((progress, details) => {
        const timed = withRemainingTime(startedAt, details);
        setProvider((state) => (state ? { ...state, status: "downloading", progress, ...timed } : state));
      });
      await Promise.all([syncProvider(), refreshModels()]);
    } catch (error) {
      if (error instanceof CancelledError) {
        await Promise.all([syncProvider(), refreshModels()]);
        return;
      }

      setProvider((state) =>
        state
          ? {
              ...state,
              status: "failed",
              progress: 0,
              error: error instanceof Error ? error.message : "The model failed to load.",
            }
          : state
      );
    }
  }, [engine, syncProvider, refreshModels]);

  const cancelDownload = useCallback(() => {
    engine().cancelDownload();
  }, [engine]);

  /** Opt-in semantic search: a small model plus one pass over the docs. */
  const enableSemanticSearch = useCallback(async () => {
    setSemantic({ status: "downloading", progress: 0 });

    try {
      await engine().enableSemanticSearch((progress) => setSemantic({ status: "downloading", progress }));
      setSemantic({ status: "ready", progress: 100 });
    } catch {
      setSemantic({ status: "failed", progress: 0 });
    }
  }, [engine]);

  const stop = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setBusy(false);
    setMessages((current) =>
      current.map((message) => (message.streaming ? { ...message, streaming: false } : message))
    );
  }, []);

  const clear = useCallback(() => {
    stop();
    setMessages([]);
    lastUnderstanding.current = null;
  }, [stop]);

  /**
   * Retrieval always runs and its sources and navigation are shown
   * immediately, even when no model is available — a reader on the wrong
   * browser still gets taken to the right section, which is most of the value.
   */
  const ask = useCallback(
    async (question: string, options: AskOptions) => {
      const trimmed = question.trim();
      if (!trimmed || busy) return;

      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      setBusy(true);

      const userMessage: AssistantMessage = {
        id: nextId.current++,
        role: "user",
        content: trimmed,
        sources: [],
        actions: [],
        performed: [],
        followUps: [],
        findings: [],
      };
      const answerId = nextId.current++;
      const history = [...messages, userMessage];

      setMessages([
        ...history,
        {
          id: answerId,
          role: "assistant",
          content: "",
          sources: [],
          actions: [],
          performed: [],
          followUps: [],
          findings: [],
          streaming: true,
          stage: "reading",
        },
      ]);

      const update = (patch: Partial<AssistantMessage>) => {
        setMessages((current) =>
          current.map((message) => (message.id === answerId ? { ...message, ...patch } : message))
        );
      };

      try {
        const understanding = understand(trimmed, {
          api: engine().api,
          currentUrl: options.currentUrl,
          previous: lastUnderstanding.current,
        });
        lastUnderstanding.current = understanding;

        const sources = await engine().retrieve(trimmed, options.currentUrl, understanding);
        const derived = deriveActions(sources, options.currentUrl, understanding.suggestedPage);
        /**
         * The ghost may only send the reader to a page it was actually shown.
         * A model that invents an API name invents a path with it, and an
         * invented destination outranks the one retrieval found — which is how
         * "why is jit fast" ends up on the schema factories page.
         */
        const context = {
          knownPages: new Set(sources.map((source) => source.section.url.split("#")[0])),
        };
        update({ sources, actions: derived, followUps: followUpsFor(sources, trimmed) });

        const selected = engine().selectProvider();
        if (!selected || (await selected.availability()) !== "ready") {
          // No model at all, but the verified answer needs none: for an
          // explanatory question the concept graph already holds it, so a
          // reader on an unsupported browser gets the substance rather than an
          // apology and a link.
          const withoutModel =
            (canAnswerFromGround(understanding) ? groundedAnswer(understanding, sources) : null) ??
            (sources.length
              ? "Here is where that lives in the docs. Load a local model and I can explain it in your own words."
              : "I could not find anything about that in the documentation.");

          update({
            streaming: false,
            stage: undefined,
            content: withoutModel,
            ...splitActions(options.perform?.(derived, { asksToNavigate: understanding.asksToNavigate }), derived),
          });
          return;
        }

        // A new subject drops the old exchange: a small model given an
        // unrelated previous answer keeps answering that one instead.
        const baseMessages = (understanding.continuation ? history.slice(-HISTORY_TURNS - 1) : [userMessage]).map(
          ({ role, content }) => ({ role, content })
        );

        const auditContext = {
          api: engine().api,
          sections: sources,
          concepts: understanding.concepts,
          surface: engine().surface,
          // the facts and strategies it was handed count as evidence too,
          // or repeating them correctly would be flagged as invention
          established: [
            ...groundTruth(understanding.concepts),
            ...mechanisms(understanding.concepts, understanding.intent),
          ],
        };

        /**
         * Everything that decides whether an answer may be shown.
         *
         * The static half reads the answer against the library's real surface.
         * The other half runs the example: a block that throws, loops or uses
         * a value it never declared is not a style problem, it is an answer
         * that does not work, and a regular expression cannot see it.
         */
        const judge = async (text: string) => {
          const findings = audit(text, auditContext);
          const block = mainExample(text);
          if (!block) return findings;

          update({ stage: "running" });
          const failure = await verifier().verify(block);
          if (failure) findings.push({ kind: "example-failed", reason: describeFailure(failure) });

          return findings;
        };

        /**
         * One generation, judged when it lands.
         *
         * Nothing paints on screen while it arrives. The reader sees the stage
         * and how much has been written, and reads the answer once — after it
         * has been checked. Watching a wrong first attempt be replaced by a
         * right second one taught them only that the ghost changes its mind.
         */
        const runPass = async (messages: { role: "user" | "assistant"; content: string }[]) => {
          let raw = "";
          let shown = 0;

          for await (const delta of selected.generate({
            messages,
            context: sources,
            api: engine().api,
            surface: engine().surface,
            currentUrl: options.currentUrl,
            editorCode: options.editorCode,
            understanding,
            maxTokens: MAX_ANSWER_TOKENS,
            signal: controller.signal,
          })) {
            raw += delta;
            // a counter that moves is enough; re-rendering per token is not
            if (raw.length - shown < PROGRESS_STEP_CHARS) continue;

            shown = raw.length;
            update({ written: shown });
          }

          update({ written: raw.length, stage: "checking" });
          const text = parseActions(raw, context).text;

          return { raw, text, findings: await judge(text) };
        };

        update({ stage: "writing" });
        let attempt = await runPass(baseMessages);

        // Generate, audit, correct, repeat. The audit already knows precisely
        // what is wrong and the model is still warm, so a wrong answer is worth
        // one more pass before it is worth a banner.
        for (let round = 0; round < MAX_REPAIRS && !controller.signal.aborted; round++) {
          const correction = repairTurn(attempt.text, attempt.findings, engine().surface);
          if (!correction) break;

          update({ stage: "correcting", attempts: round + 2, written: 0 });
          const retry = await runPass([
            ...baseMessages,
            { role: "assistant" as const, content: attempt.raw },
            { role: "user" as const, content: correction },
          ]);

          attempt = betterAttempt(attempt, retry);
        }

        /**
         * When only the example is beyond saving, keep the answer and replace
         * the example.
         *
         * The prose passed every check; the block did not run. Throwing the
         * whole answer away for that loses an explanation the reader can use,
         * and showing a broken block under it is worse. The documentation
         * already contains an example of this subject that the test suite
         * executes, so the ghost hands over that one and says where it came
         * from.
         */
        const severe = attempt.findings.filter(isSevere);
        if (severe.length > 0 && severe.every(isAboutTheExample)) {
          const verified = verifiedExampleFor(understanding);

          if (verified) {
            attempt = {
              raw: attempt.raw,
              text: replaceMainExample(attempt.text, verified, VERIFIED_EXAMPLE_NOTE[understanding.language]),
              findings: attempt.findings.filter((finding) => !isAboutTheExample(finding)),
            };
          }
        }

        /**
         * When every attempt still fails, stop asking the model to say it.
         *
         * A 0.8B model handed six correct sections about why jit is fast still
         * produced "compila o código na memória da memória RAM" and an example
         * running a SQL query. Showing the reader its third attempt, wrong and
         * labelled wrong, serves nobody — the right answer is already written
         * down and verified in the concept graph, so the ghost says that
         * instead. Only for explanatory questions: a how-to needs code shaped
         * to what the reader is building, which a fixed paragraph cannot do.
         */
        const grounded =
          attempt.findings.some(isSevere) && canAnswerFromGround(understanding)
            ? groundedAnswer(understanding, sources)
            : null;

        if (grounded) attempt = { raw: grounded, text: grounded, findings: [] };

        // The tags come from what the model wrote; the answer is what survived
        // judging, which is not the same string once an example was replaced.
        const parsed = parseActions(attempt.raw, context);
        const answer = attempt.text;
        // a schema the ghost wrote is an action too, and the one the reader
        // most likely wants carried out
        const written = codeActionFrom(answer);
        const demo = demoActionFor(written, options.currentUrl);
        const fromModel = [written, demo, ...parsed.actions].filter((action): action is AssistantAction =>
          Boolean(action)
        );
        const actions = mergeActions(fromModel, derived);
        // acting only once the answer is complete: navigating mid-sentence
        // pulls the page out from under whoever is still reading it
        update({
          content: answer,
          streaming: false,
          stage: undefined,
          // whatever survived the last pass — the banner reports only what the
          // model could not be talked out of
          findings: attempt.findings,
          ...splitActions(options.perform?.(actions, { asksToNavigate: understanding.asksToNavigate }), actions),
        });
      } catch (error) {
        if (!controller.signal.aborted) {
          update({
            streaming: false,
            error: error instanceof Error ? error.message : "The local model failed to answer.",
          });
        }
      } finally {
        if (abortRef.current === controller) abortRef.current = null;
        setBusy(false);
      }
    },
    [busy, engine, messages, verifier]
  );

  return {
    messages,
    busy,
    indexError,
    provider,
    models,
    semantic,
    initialize,
    refreshModels,
    selectModel,
    prepareProvider,
    cancelDownload,
    enableSemanticSearch,
    ask,
    stop,
    clear,
  };
}
