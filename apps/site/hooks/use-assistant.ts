"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { acceptedHistory } from "@/lib/copilot/application/context/history";
import type { ModelState, ModelStatus } from "@/lib/copilot/application/services/model.service";
import type { GenerationModelSpec } from "@/lib/copilot/config/models";
import type { AuditFinding } from "@/lib/copilot/core/entities/audit";
import type { GenerationMessage } from "@/lib/copilot/core/ports/language-model";
import { detectLocale } from "@/lib/copilot/core/value-objects/locale";
import {
  asksToNavigate,
  codeActionFrom,
  demoActionFor,
  type GhostAction,
  type GhostPerformedAction,
  type GhostSource,
  mergeGhostActions,
} from "@/lib/copilot/presentation/adapters/ghost";
import { CopilotController } from "@/lib/copilot/presentation/controllers/copilot.controller";

export type AnswerStage = "reading" | "writing" | "checking" | "running" | "correcting";
export type PerformedAction = GhostPerformedAction;

export interface AssistantMessage {
  id: number;
  role: "user" | "assistant";
  content: string;
  sources: GhostSource[];
  actions: GhostAction[];
  performed: PerformedAction[];
  followUps: string[];
  findings: AuditFinding[];
  rejected?: boolean;
  streaming?: boolean;
  stage?: AnswerStage;
  written?: number;
  attempts?: number;
  error?: string;
}

export interface SemanticState {
  status: ModelStatus;
  progress: number;
}

export interface ModelChoice extends GenerationModelSpec {
  selected: boolean;
}

export interface AskOptions {
  currentUrl: string;
  editorCode?: string;
  perform?: (
    actions: GhostAction[],
    context: PerformContext
  ) => { performed: PerformedAction[]; offered: GhostAction[] };
}

export interface PerformContext {
  asksToNavigate: boolean;
}

const EMPTY_MODEL: ModelState = {
  tier: "light",
  label: "",
  status: "unsupported",
  progress: 0,
};

function splitActions(
  result: { performed: PerformedAction[]; offered: GhostAction[] } | undefined,
  fallback: GhostAction[]
) {
  return {
    performed: result?.performed ?? [],
    actions: result?.offered ?? fallback,
  };
}

function fallbackActions(sources: readonly GhostSource[], currentPath: string): GhostAction[] {
  const best = sources[0];
  if (!best) return [];

  return best.url.split("#")[0] === currentPath.split("#")[0]
    ? [
        {
          kind: "highlight",
          heading: best.heading,
          label: `Point at "${best.heading}"`,
        },
      ]
    : [{ kind: "navigate", url: best.url, label: `Open ${best.page}` }];
}

function searchFloor(locale: "en" | "pt-BR", found: boolean): string {
  if (locale === "pt-BR") {
    return found
      ? "Encontrei estas fontes verificadas na documentação. Abra a principal abaixo para ler a explicação completa."
      : "Não encontrei evidência sobre isso na documentação atual.";
  }

  return found
    ? "I found these verified sources in the documentation. Open the first one below for the complete explanation."
    : "I found no evidence about that in the current documentation.";
}

/** React state for the new copilot controller; no legacy knowledge graph. */
export function useAssistant() {
  const controllerRef = useRef<CopilotController | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const unsubscribeRef = useRef<(() => void) | null>(null);
  const nextId = useRef(1);

  const [messages, setMessages] = useState<AssistantMessage[]>([]);
  const [indexError, setIndexError] = useState<string | null>(null);
  const [provider, setProvider] = useState<ModelState>(EMPTY_MODEL);
  const [models, setModels] = useState<ModelChoice[]>([]);
  const [semantic, setSemantic] = useState<SemanticState>({
    status: "needs-download",
    progress: 0,
  });
  const [busy, setBusy] = useState(false);

  const controller = useCallback(() => {
    controllerRef.current ??= new CopilotController();
    return controllerRef.current;
  }, []);

  const refreshModels = useCallback(async () => {
    const current = controller();
    const choices = current.models.availableTiers.map((model) => ({
      ...model,
      selected: current.models.current.tier === model.tier,
    }));
    setModels(choices);
    return choices;
  }, [controller]);

  const initialize = useCallback(async () => {
    const current = controller();

    try {
      await current.initialize();
      setIndexError(null);
      unsubscribeRef.current ??= current.models.subscribe((state) => setProvider(state));
      await refreshModels();
    } catch (error) {
      setIndexError(error instanceof Error ? error.message : "The knowledge artifacts could not be loaded.");
    }
  }, [controller, refreshModels]);

  useEffect(
    () => () => {
      abortRef.current?.abort();
      unsubscribeRef.current?.();
      controllerRef.current?.dispose();
    },
    []
  );

  const selectModel = useCallback(
    async (model: GenerationModelSpec) => {
      controller().models.selectTier(model.tier);
      await refreshModels();
    },
    [controller, refreshModels]
  );

  const prepareProvider = useCallback(async () => {
    await initialize();
    await controller().models.prepare();
    await refreshModels();
  }, [controller, initialize, refreshModels]);

  const cancelDownload = useCallback(() => controller().models.cancelDownload(), [controller]);

  const enableSemanticSearch = useCallback(async () => {
    setSemantic({ status: "downloading", progress: 0 });
    const ready = await controller().prepareEmbedding((progress) => setSemantic({ status: "downloading", progress }));
    setSemantic({
      status: ready ? "ready" : "failed",
      progress: ready ? 100 : 0,
    });
  }, [controller]);

  const stop = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setBusy(false);
    setMessages((current) =>
      current.map((message) => (message.streaming ? { ...message, streaming: false, stage: undefined } : message))
    );
  }, []);

  const clear = useCallback(() => {
    stop();
    setMessages([]);
  }, [stop]);

  const ask = useCallback(
    async (question: string, options: AskOptions) => {
      const trimmed = question.trim();
      if (!trimmed || busy) return;

      const current = controller();
      await initialize();

      const controllerAbort = new AbortController();
      abortRef.current?.abort();
      abortRef.current = controllerAbort;
      setBusy(true);

      const user: AssistantMessage = {
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
      const transcript = [...messages, user];

      setMessages([
        ...transcript,
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
          written: 0,
        },
      ]);

      const update = (patch: Partial<AssistantMessage>) => {
        setMessages((state) => state.map((message) => (message.id === answerId ? { ...message, ...patch } : message)));
      };

      try {
        const history: GenerationMessage[] = acceptedHistory(transcript);
        let written = 0;
        const response = await current.ask({
          question: trimmed,
          currentPath: options.currentUrl,
          history,
          signal: controllerAbort.signal,
          onDelta: (delta) => {
            written += delta.length;
            update({ stage: "writing", written });
          },
        });

        if (controllerAbort.signal.aborted) return;
        update({ stage: "checking" });

        if (response.kind === "search") {
          const locale = detectLocale(trimmed);
          const presented = current.present(response.context.evidence, [], locale);
          const derived = fallbackActions(presented.sources, options.currentUrl);
          update({
            content: searchFloor(locale, presented.sources.length > 0),
            sources: presented.sources,
            streaming: false,
            stage: undefined,
            ...splitActions(
              options.perform?.(derived, {
                asksToNavigate: asksToNavigate(trimmed),
              }),
              derived
            ),
          });
          return;
        }

        if (response.kind === "schema") {
          const locale = detectLocale(trimmed);
          const presented = current.present(response.context.evidence, [], locale);
          const result = response.result;

          if (!result.ok) {
            update({
              content:
                locale === "pt-BR"
                  ? `Não consegui gerar um schema verificável: ${result.issues.join(" ")}`
                  : `I could not generate a verifiable schema: ${result.issues.join(" ")}`,
              sources: presented.sources,
              streaming: false,
              stage: undefined,
              attempts: result.retried ? 2 : 1,
            });
            return;
          }

          const content = `${locale === "pt-BR" ? "Schema gerado deterministicamente a partir de um intent validado:" : "Schema generated deterministically from a validated intent:"}\n\n\`\`\`ts\n${result.code}\n\`\`\``;
          const workspace = codeActionFrom(content);
          const demo = demoActionFor(workspace, options.currentUrl);
          const actions = [workspace, demo].filter((action): action is GhostAction => action !== null);

          update({
            content,
            sources: presented.sources,
            streaming: false,
            stage: undefined,
            attempts: result.retried ? 2 : 1,
            ...splitActions(options.perform?.(actions, { asksToNavigate: false }), actions),
          });
          return;
        }

        const answer = response.answer;
        const presented = current.present(answer.evidence, answer.actions, answer.locale);
        const code = codeActionFrom(answer.text);
        const demo = demoActionFor(code, options.currentUrl);
        const actions = mergeGhostActions(
          [code, demo].filter((action): action is GhostAction => action !== null),
          presented.actions
        );

        update({
          content: answer.text,
          sources: presented.sources,
          // Findings describe prose that was discarded. Showing them beside
          // the safe fallback made the fallback itself look wrong.
          findings: answer.rejected ? [] : answer.audit.findings,
          rejected: answer.rejected,
          attempts: answer.retried ? 2 : 1,
          streaming: false,
          stage: undefined,
          ...splitActions(
            options.perform?.(actions, {
              asksToNavigate: asksToNavigate(trimmed),
            }),
            actions
          ),
        });
      } catch (error) {
        if (!controllerAbort.signal.aborted) {
          update({
            streaming: false,
            stage: undefined,
            error: error instanceof Error ? error.message : "The local copilot failed to answer.",
          });
        }
      } finally {
        if (abortRef.current === controllerAbort) abortRef.current = null;
        setBusy(false);
      }
    },
    [busy, controller, initialize, messages]
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
