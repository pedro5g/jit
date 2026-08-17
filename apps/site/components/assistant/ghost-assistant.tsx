"use client";

import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  BookOpen,
  Check,
  Footprints,
  Maximize2,
  Minimize2,
  MousePointerClick,
  Navigation,
  PenLine,
  RotateCcw,
  Settings2,
  Sparkles,
  Square,
  Trash2,
  Undo2,
  X,
} from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { AssistantAnswer, AssistantSources, FollowUps } from "@/components/assistant/assistant-answer";
import { ModelPicker } from "@/components/assistant/model-picker";
import { JitGhost } from "@/components/brand/jit-ghost";
import {
  type AnswerStage,
  type AssistantMessage,
  type PerformContext,
  type PerformedAction,
  useAssistant,
} from "@/hooks/use-assistant";
import { type AssistantAction, planActions } from "@/lib/assistant/actions";
import { type AuditFinding, isSevere } from "@/lib/assistant/audit";
import {
  ASSISTANT_OPEN_EVENT,
  readEditorCode,
  requestHighlight,
  requestHighlightAfterNavigation,
  requestSnippetDemo,
  requestWorkspaceWrite,
} from "@/lib/assistant/bus";

/**
 * Openers that retrieval answers well. A prompt like "write me a schema" is a
 * command rather than a topic: it shares no distinctive word with any page, so
 * it lands wherever the shortest section happens to be. Phrasing the same
 * intent as a question is what puts the right page in front of the model.
 */
const SUGGESTIONS = [
  "What replaced JIT.validator in 2.0?",
  "How do I declare a schema and validate a value?",
  "Why is the generated code so fast?",
];

/** Below this distance from the bottom, new tokens keep the view pinned. */
const STICK_THRESHOLD_PX = 64;

type Shell = "closed" | "dock" | "modal";

/**
 * The ghost's body. It reads the page the reader is on, answers from the docs,
 * and then does something about it: takes them to the section, points at it on
 * the page they are already on, or writes the schema into the workspace.
 */
export function GhostAssistant() {
  const pathname = usePathname();
  const router = useRouter();
  const [shell, setShell] = useState<Shell>("closed");
  const [draft, setDraft] = useState("");
  const [showModels, setShowModels] = useState(false);
  const [stuckToBottom, setStuckToBottom] = useState(true);
  const assistant = useAssistant();
  const { initialize, ask, messages } = assistant;
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const lastQuestion = useRef<string | null>(null);

  useEffect(() => {
    const onOpen = (event: Event) => {
      // the reading guide can open the panel with a question already written
      const question = (event as CustomEvent<{ question?: string }>).detail?.question;
      if (question) setDraft(question);
      setShell((current) => (current === "closed" ? "dock" : current));
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "i") {
        event.preventDefault();
        setShell((current) => (current === "closed" ? "dock" : "closed"));
      }
      if (event.key === "Escape") setShell((current) => (current === "modal" ? "dock" : "closed"));
    };

    window.addEventListener(ASSISTANT_OPEN_EVENT, onOpen);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener(ASSISTANT_OPEN_EVENT, onOpen);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, []);

  useEffect(() => {
    if (shell === "closed") return;
    void initialize();
    inputRef.current?.focus();
  }, [shell, initialize]);

  /**
   * Tokens arriving should not yank the view down while the reader is scrolled
   * up re-reading something earlier in the conversation. Following only when
   * they are already at the bottom is what makes a stream feel calm.
   */
  // biome-ignore lint/correctness/useExhaustiveDependencies(messages): the transcript changing is the trigger; the element is read from the ref
  useEffect(() => {
    if (!stuckToBottom) return;
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, stuckToBottom]);

  const onScroll = useCallback(() => {
    const element = scrollRef.current;
    if (!element) return;

    const distance = element.scrollHeight - element.scrollTop - element.clientHeight;
    setStuckToBottom(distance < STICK_THRESHOLD_PX);
  }, []);

  /**
   * What the ghost is allowed to do without being asked twice.
   *
   * Pointing is free, so it happens. Navigating is not: it replaces whatever
   * the reader was reading, including the answer they are halfway through, and
   * "pq a jit é rápida" is a request for an explanation rather than a request
   * to be moved. So a destination becomes a link in the conversation unless
   * the reader actually asked to go there. Writing code is applied instantly
   * where the editor is already open, and offered as a button when it is not.
   */
  const perform = useCallback(
    (actions: AssistantAction[], context: PerformContext) => {
      const { auto, offered } = planActions(actions, pathname, {
        readerAskedToNavigate: context.asksToNavigate,
      });
      const performed: PerformedAction[] = [];

      for (const action of auto) {
        if (action.kind === "highlight") {
          requestHighlight({ heading: action.heading });
          performed.push({ kind: "highlight", label: `pointed at "${action.heading}"` });
          continue;
        }

        if (action.kind === "navigate") {
          const from = `${pathname}${window.location.hash}`;
          router.push(action.url);
          performed.push({
            kind: "navigate",
            label: `took you to ${action.label.replace(/^Take me to /, "")}`,
            undo: () => router.push(from),
          });
          continue;
        }

        if (action.kind === "workspace") {
          requestWorkspaceWrite({ code: action.code, mode: action.mode, reason: "written by the ghost" });
          performed.push({ kind: "workspace", label: "wrote it into the editor" });
        }
      }

      return { performed, offered };
    },
    [pathname, router]
  );

  const submit = useCallback(
    (question: string) => {
      if (!question.trim()) return;

      lastQuestion.current = question;
      setDraft("");
      setStuckToBottom(true);
      void ask(question, { currentUrl: pathname, editorCode: readEditorCode(), perform });
    },
    [ask, pathname, perform]
  );

  const regenerate = useCallback(() => {
    if (lastQuestion.current) submit(lastQuestion.current);
  }, [submit]);

  /** A snippet the reader chose to open, rather than one the ghost applied. */
  const openCode = useCallback(
    (code: string, mode: "run" | "generate") => {
      const delivered = requestWorkspaceWrite({ code, mode, reason: "opened from the conversation" });
      if (!delivered) router.push("/workspace");
      setShell("dock");
    },
    [router]
  );

  /**
   * Being taken to the passage, rather than to the page it is on.
   *
   * "take me there" used to mean a route change and nothing else: the reader
   * landed at the top of a long page still holding the question. Guiding parks
   * the passage first, so the page opens already scrolled to it with the guide
   * pointing — and the panel gets out of the way when they asked to be walked
   * over, because reading is what they are about to do.
   */
  const guide = useCallback(
    (url: string, heading: string, close: boolean) => {
      const samePage = url.split("#")[0] === pathname;

      if (samePage) requestHighlight({ heading });
      else {
        requestHighlightAfterNavigation({ heading });
        router.push(url);
      }

      setShell(close ? "closed" : "dock");
    },
    [pathname, router]
  );

  const act = useCallback(
    (action: AssistantAction) => {
      if (action.kind === "workspace") {
        openCode(action.code, action.mode);
        return;
      }
      if (action.kind === "demo") {
        requestSnippetDemo({ code: action.code, near: action.near });
        setShell("dock");
        return;
      }
      if (action.kind === "highlight") {
        requestHighlight({ heading: action.heading });
        return;
      }

      router.push(action.url);
      setShell("dock");
    },
    [openCode, router]
  );

  if (shell === "closed") {
    return (
      <button
        type="button"
        onClick={() => setShell("dock")}
        aria-label="Ask the ghost"
        className="fixed bottom-5 right-5 z-50 inline-flex items-center gap-2 rounded-pill border border-line-gold/50 bg-night-950/95 py-1.5 pl-1.5 pr-3.5 shadow-(--shadow-card) backdrop-blur transition-colors hover:border-line-gold hover:bg-night-900"
      >
        <JitGhost size={28} state="observing" follow="none" />
        <span className="font-mono text-[11px] text-ghost-100">Ask the ghost</span>
        <kbd className="hidden rounded-pixel border border-line-subtle px-1 font-mono text-[10px] text-fg-subtle sm:inline">
          ⌘I
        </kbd>
      </button>
    );
  }

  const panel = (
    <section
      aria-label="Documentation assistant"
      className={
        shell === "modal"
          ? "flex h-[min(780px,calc(100dvh-4rem))] w-[min(780px,calc(100vw-2rem))] flex-col overflow-hidden rounded-card border border-line-gold/40 bg-night-950 shadow-(--shadow-card)"
          : // a phone gets a bottom sheet, where a floating card would cover the
            // page it is talking about and still be too narrow to read
            "fixed inset-x-0 bottom-0 z-50 flex max-h-[85dvh] flex-col overflow-hidden rounded-t-card border-t border-line-gold/40 bg-night-950/97 shadow-(--shadow-card) backdrop-blur sm:inset-x-auto sm:bottom-4 sm:right-4 sm:max-h-[min(700px,calc(100dvh-2rem))] sm:w-[min(420px,calc(100vw-2rem))] sm:rounded-card sm:border"
      }
    >
      <header className="flex shrink-0 items-center gap-2 border-b border-line-subtle px-3 py-2">
        <JitGhost size={26} state={assistant.busy ? "compiling" : "observing"} follow="none" />
        <div className="flex min-w-0 flex-col">
          <span className="flex items-center gap-1.5">
            <span className="font-pixel-badge text-[11px] uppercase tracking-wider text-gold-200">ghost</span>
            <span
              title="Written answers come from a model on your machine. Retrieval, the sources and every executed example are not in beta."
              className="rounded-pill border border-line-subtle px-1.5 font-mono text-[9px] uppercase tracking-wide text-fg-subtle"
            >
              beta
            </span>
          </span>
          <span className="truncate font-mono text-[10px] text-fg-subtle">
            {assistant.busy ? "thinking…" : (assistant.provider?.label ?? "retrieval only")}
            {assistant.semantic.status === "ready" ? " · semantic" : ""}
            {assistant.indexError ? " · index unavailable" : ""}
          </span>
        </div>

        <div className="ml-auto flex items-center gap-0.5">
          <IconButton
            label="Local models"
            active={showModels}
            onClick={() => setShowModels((current) => !current)}
            icon={<Settings2 aria-hidden className="size-3.5" />}
          />
          {messages.length > 0 && (
            <IconButton
              label="Clear this conversation"
              onClick={assistant.clear}
              icon={<Trash2 aria-hidden className="size-3.5" />}
            />
          )}
          <IconButton
            label={shell === "modal" ? "Dock the assistant" : "Expand the assistant"}
            onClick={() => setShell(shell === "modal" ? "dock" : "modal")}
            icon={
              shell === "modal" ? (
                <Minimize2 aria-hidden className="size-3.5" />
              ) : (
                <Maximize2 aria-hidden className="size-3.5" />
              )
            }
          />
          <IconButton
            label="Close the assistant"
            onClick={() => setShell("closed")}
            icon={<X aria-hidden className="size-4" />}
          />
        </div>
      </header>

      {showModels && (
        <div className="shrink-0 border-b border-line-subtle px-3 py-2.5">
          <ModelPicker
            models={assistant.models}
            provider={assistant.provider}
            onSelect={(model) => void assistant.selectModel(model)}
            onDownload={() => void assistant.prepareProvider()}
            onCancel={assistant.cancelDownload}
            onRemoved={() => void assistant.refreshModels()}
          />
          {assistant.semantic.status !== "ready" && (
            <button
              type="button"
              onClick={() => void assistant.enableSemanticSearch()}
              className="mt-2 inline-flex items-center gap-1.5 text-[11px] text-fg-muted hover:text-gold-200"
            >
              <Sparkles aria-hidden className="size-3 text-gold-200/60" />
              {assistant.semantic.status === "downloading"
                ? `indexing semantically — ${Math.round(assistant.semantic.progress)}%`
                : "Add semantic search (23 MB, once)"}
            </button>
          )}
        </div>
      )}

      <div className="relative min-h-0 flex-1">
        <div ref={scrollRef} onScroll={onScroll} className="h-full overflow-y-auto px-3 py-3">
          {messages.length === 0 ? (
            <Welcome provider={assistant.provider} onAsk={submit} onOpenModels={() => setShowModels(true)} />
          ) : (
            <ol className="flex flex-col gap-5">
              {messages.map((message, index) => (
                <li key={message.id}>
                  {message.role === "user" ? (
                    <p className="ml-auto w-fit max-w-[85%] rounded-card rounded-br-sm bg-surface-800 px-3 py-2 text-sm leading-relaxed text-fg">
                      {message.content}
                    </p>
                  ) : (
                    <Turn
                      message={message}
                      last={index === messages.length - 1}
                      busy={assistant.busy}
                      onRunCode={openCode}
                      onAct={act}
                      onAsk={submit}
                      onGuide={guide}
                      onRegenerate={regenerate}
                    />
                  )}
                </li>
              ))}
            </ol>
          )}
        </div>

        {!stuckToBottom && messages.length > 0 && (
          <button
            type="button"
            aria-label="Jump to the latest message"
            onClick={() => setStuckToBottom(true)}
            className="absolute bottom-3 left-1/2 inline-flex -translate-x-1/2 items-center gap-1 rounded-pill border border-line-subtle bg-night-900/95 px-2.5 py-1 font-mono text-[10px] text-fg-muted shadow-(--shadow-card) backdrop-blur hover:text-gold-200"
          >
            <ArrowDown aria-hidden className="size-3" />
            latest
          </button>
        )}
      </div>

      <form
        className="flex shrink-0 items-end gap-2 border-t border-line-subtle p-2"
        onSubmit={(event) => {
          event.preventDefault();
          submit(draft);
        }}
      >
        <textarea
          ref={inputRef}
          value={draft}
          rows={1}
          placeholder="Ask about jit, or describe what you are building…"
          onChange={(event) => {
            setDraft(event.target.value);
            // grow with the question instead of scrolling a one-line box
            event.target.style.height = "auto";
            event.target.style.height = `${Math.min(event.target.scrollHeight, 140)}px`;
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              submit(draft);
            }
          }}
          className="max-h-36 min-h-9 flex-1 resize-none rounded-control border border-line-subtle bg-night-1000/60 px-3 py-2 text-sm leading-relaxed text-fg outline-none transition-colors placeholder:text-fg-subtle focus:border-line-gold"
        />
        {assistant.busy ? (
          <button
            type="button"
            onClick={assistant.stop}
            aria-label="Stop generating"
            className="inline-flex size-9 shrink-0 items-center justify-center rounded-control border border-line-subtle text-fg-muted transition-colors hover:border-line-gold hover:text-gold-200"
          >
            <Square aria-hidden className="size-3.5" />
          </button>
        ) : (
          <button
            type="submit"
            disabled={draft.trim().length === 0}
            aria-label="Send the question"
            className="inline-flex size-9 shrink-0 items-center justify-center rounded-control border border-line-gold/50 bg-gold-200/10 text-gold-200 transition-opacity disabled:opacity-40"
          >
            <ArrowUp aria-hidden className="size-4" />
          </button>
        )}
      </form>
    </section>
  );

  if (shell === "dock") return panel;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button
        type="button"
        aria-label="Close the assistant"
        onClick={() => setShell("dock")}
        className="absolute inset-0 cursor-default bg-night-1000/70 backdrop-blur-sm"
      />
      <div className="relative">{panel}</div>
    </div>
  );
}

function IconButton({
  label,
  icon,
  onClick,
  active,
}: {
  label: string;
  icon: React.ReactNode;
  onClick: () => void;
  active?: boolean;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={active}
      onClick={onClick}
      className={`inline-flex size-7 items-center justify-center rounded-md transition-colors ${
        active ? "text-gold-200" : "text-fg-subtle hover:text-ghost-100"
      }`}
    >
      {icon}
    </button>
  );
}

/** One answer: the ghost beside it, what it wrote, and what it did about it. */
function Turn({
  message,
  last,
  busy,
  onRunCode,
  onAct,
  onAsk,
  onGuide,
  onRegenerate,
}: {
  message: AssistantMessage;
  last: boolean;
  busy: boolean;
  onRunCode: (code: string, mode: "run" | "generate") => void;
  onAct: (action: AssistantAction) => void;
  onAsk: (question: string) => void;
  onGuide: (url: string, heading: string, close: boolean) => void;
  onRegenerate: () => void;
}) {
  const severe = message.findings.filter(isSevere);

  return (
    <div className="flex gap-2.5">
      <span className="mt-0.5 shrink-0">
        <JitGhost size={22} state={message.streaming ? "typing" : "idle"} follow="none" />
      </span>

      <div className="min-w-0 flex-1">
        {message.error ? (
          <p className="rounded-control border border-danger/40 px-3 py-2 text-xs text-danger">{message.error}</p>
        ) : (
          <>
            {severe.length > 0 && !message.streaming && (
              <p className="mb-2 flex items-start gap-1.5 rounded-control border border-danger/50 bg-danger/10 px-2.5 py-1.5 text-[11px] font-semibold leading-relaxed text-danger">
                <AlertTriangle aria-hidden className="mt-0.5 size-3 shrink-0" />
                This answer is wrong in the places listed under it. Read those first.
              </p>
            )}

            {message.streaming ? (
              <Working message={message} />
            ) : (
              <AssistantAnswer content={message.content} sources={message.sources} onRunCode={onRunCode} />
            )}

            {message.performed.length > 0 && <Performed actions={message.performed} />}

            {message.actions.length > 0 && !message.streaming && (
              <ul className="mt-2.5 flex flex-wrap gap-1.5">
                {message.actions.map((action) => (
                  <li key={action.kind + action.label}>
                    <button
                      type="button"
                      onClick={() => onAct(action)}
                      className="inline-flex items-center gap-1.5 rounded-control border border-line-gold/40 bg-gold-200/5 px-2 py-1 text-[11px] text-gold-200 transition-colors hover:bg-gold-200/15"
                    >
                      {action.kind === "navigate" ? (
                        <Navigation aria-hidden className="size-3" />
                      ) : action.kind === "highlight" ? (
                        <MousePointerClick aria-hidden className="size-3" />
                      ) : action.kind === "demo" ? (
                        <Sparkles aria-hidden className="size-3" />
                      ) : (
                        <PenLine aria-hidden className="size-3" />
                      )}
                      {action.label}
                    </button>
                  </li>
                ))}
              </ul>
            )}

            {message.findings.length > 0 && !message.streaming && <Audit findings={message.findings} />}

            {!message.streaming && <Guide sources={message.sources} onGuide={onGuide} />}
            <AssistantSources sources={message.sources} />
            {!message.streaming && <FollowUps questions={message.followUps} onAsk={onAsk} />}

            {last && !message.streaming && !busy && (
              <button
                type="button"
                onClick={onRegenerate}
                className="mt-2 inline-flex items-center gap-1 text-[10px] text-fg-subtle transition-colors hover:text-gold-200"
              >
                <RotateCcw aria-hidden className="size-2.5" />
                try again
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}

/**
 * Two ways to be shown where the answer came from.
 *
 * The sources under an answer are a list of links, and a list of links is work
 * the reader has to do: open it, find the passage, decide whether it is the
 * one. These do that part. "Show me" opens the page already scrolled to the
 * passage with the guide pointing at it and the panel still there; "guide me"
 * gets the panel out of the way too, because someone who asked to be walked
 * over is about to read rather than to ask again.
 */
function Guide({
  sources,
  onGuide,
}: {
  sources: AssistantMessage["sources"];
  onGuide: (url: string, heading: string, close: boolean) => void;
}) {
  const best = sources[0]?.section;
  if (!best) return null;

  return (
    <ul className="mt-2 flex flex-wrap gap-1.5">
      <li>
        <button
          type="button"
          onClick={() => onGuide(best.url, best.heading, false)}
          className="inline-flex items-center gap-1.5 rounded-control border border-line-subtle px-2 py-1 text-[11px] text-fg-muted transition-colors hover:border-line-gold hover:text-gold-200"
        >
          <BookOpen aria-hidden className="size-3" />
          Show me in the docs
        </button>
      </li>
      <li>
        <button
          type="button"
          onClick={() => onGuide(best.url, best.heading, true)}
          className="inline-flex items-center gap-1.5 rounded-control border border-line-subtle px-2 py-1 text-[11px] text-fg-muted transition-colors hover:border-line-gold hover:text-gold-200"
        >
          <Footprints aria-hidden className="size-3" />
          Guide me there
        </button>
      </li>
    </ul>
  );
}

/**
 * What the audit caught. Each line is a statement of fact — the public
 * surface, the sections, and the established facts are all known exactly —
 * so this hedges nothing, and it is what stops a confident wrong answer from
 * costing the reader an afternoon.
 */
function Audit({ findings }: { findings: AuditFinding[] }) {
  return (
    <ul className="mt-2 flex flex-col gap-1 rounded-control border border-warning/40 bg-warning/5 px-2.5 py-1.5">
      {findings.map((finding) => (
        <li key={finding.kind} className="flex items-start gap-1.5 text-[11px] leading-relaxed text-warning">
          <AlertTriangle aria-hidden className="mt-0.5 size-3 shrink-0" />
          <span>{describe(finding)}</span>
        </li>
      ))}
    </ul>
  );
}

function describe(finding: AuditFinding): string {
  if (finding.kind === "invented-api") {
    const plural = finding.names.length > 1;
    return `${finding.names.join(", ")} ${plural ? "are not" : "is not"} part of jit — the model made ${plural ? "them" : "it"} up.`;
  }

  if (finding.kind === "invented-method") {
    const plural = finding.names.length > 1;
    return `${finding.names.join(", ")} ${plural ? "do" : "does"} not exist on any jit schema — checked against the compiled library, not the docs.`;
  }

  if (finding.kind === "invented-cli") {
    return `${finding.names.join(", ")} is not a command the jit CLI has. It has: jit init, jit generate, jit watch, jit check, jit mcp.`;
  }

  if (finding.kind === "unusable-example") {
    return `The code example does not work: ${finding.reason}`;
  }

  if (finding.kind === "example-failed") {
    return `I ran this example before showing it, and ${finding.reason}`;
  }

  if (finding.kind === "degenerated") {
    return `The model's output came apart: ${finding.reason}`;
  }

  if (finding.kind === "contradiction") {
    return `This contradicts the documentation: ${finding.claim}`;
  }

  if (finding.kind === "unsupported-number") {
    return `${finding.values.join(", ")} appears in none of the sources below — treat the figure as invented.`;
  }

  const plural = finding.sentences.length > 1;
  return `Nothing in the sources supports ${plural ? "these claims" : "this claim"}: ${finding.sentences.map((sentence) => `"${sentence}"`).join(" ")}`;
}

/** The stages, in the order they happen, with what each one is doing. */
const STAGES: { id: AnswerStage; label: string }[] = [
  { id: "reading", label: "reading the docs" },
  { id: "writing", label: "writing the answer" },
  { id: "checking", label: "checking it against the library" },
  { id: "running", label: "running the example" },
  { id: "correcting", label: "correcting what failed" },
];

/**
 * What the ghost is doing, while it is doing it.
 *
 * The answer itself is not shown until it has been checked, so this is the
 * whole of the wait. It is built to be worth reading rather than to fill the
 * gap: the sections it found are already on screen, so a reader can tell
 * whether the ghost is looking in the right place before a word is generated,
 * and "running the example" is a real step with a real outcome rather than a
 * spinner with a caption.
 */
function Working({ message }: { message: AssistantMessage }) {
  const stage = message.stage ?? "reading";
  const reached = STAGES.findIndex((entry) => entry.id === stage);
  // correcting is a second pass over the same ground, so nothing before it is
  // "done" in the way the first pass was
  const passed = stage === "correcting" ? STAGES.length : reached;

  return (
    <div className="flex flex-col gap-1.5 py-1">
      <ol className="flex flex-col gap-1">
        {STAGES.map((entry, index) => {
          if (index > reached) return null;
          const active = entry.id === stage;

          return (
            <li key={entry.id} className="flex items-center gap-1.5 text-xs">
              {active ? (
                <span className="flex items-center gap-0.5">
                  <span className="assistant-dot" />
                  <span className="assistant-dot" style={{ animationDelay: "0.15s" }} />
                  <span className="assistant-dot" style={{ animationDelay: "0.3s" }} />
                </span>
              ) : (
                <Check aria-hidden className="size-3 shrink-0 text-success" />
              )}
              <span className={active ? "text-ghost-100" : "text-fg-subtle"}>
                {entry.label}
                {active && entry.id === "writing" && message.written ? ` · ${message.written} chars` : ""}
                {active && entry.id === "correcting" && message.attempts ? ` · attempt ${message.attempts}` : ""}
              </span>
            </li>
          );
        })}
      </ol>

      {passed >= 0 &&
        message.sources.slice(0, 3).map((source) => (
          <p
            key={source.section.url + source.section.part}
            className="truncate pl-1 font-mono text-[10px] text-fg-subtle"
          >
            {source.section.page} · {source.section.heading}
          </p>
        ))}
    </div>
  );
}

/** What the ghost already did, stated plainly and reversibly. */
function Performed({ actions }: { actions: PerformedAction[] }) {
  return (
    <ul className="mt-2 flex flex-col gap-1">
      {actions.map((action) => (
        <li key={action.kind + action.label} className="flex items-center gap-1.5">
          <span className="font-mono text-[11px] text-gold-200/70">→</span>
          <span className="text-[11px] text-fg-muted">{action.label}</span>
          {action.undo && (
            <button
              type="button"
              onClick={action.undo}
              className="inline-flex items-center gap-1 text-[10px] text-fg-subtle transition-colors hover:text-gold-200"
            >
              <Undo2 aria-hidden className="size-2.5" />
              undo
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}

function Welcome({
  provider,
  onAsk,
  onOpenModels,
}: {
  provider: ReturnType<typeof useAssistant>["provider"];
  onAsk: (question: string) => void;
  onOpenModels: () => void;
}) {
  const needsModel = provider?.status !== "ready";

  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs leading-relaxed text-fg-muted">
        I read these docs with you. Ask anything about jit and I will find the passage, walk you to it, or write the
        schema into your workspace. Everything runs on your machine.
      </p>
      <p className="rounded-control border border-line-subtle bg-surface-900/40 px-2.5 py-2 text-[11px] leading-relaxed text-fg-subtle">
        Written answers are beta. A small local model writes them, so they can still be wrong: I run every code example
        before showing it and check every name against the compiled library, and the sources under each answer are the
        thing to trust.
      </p>

      {needsModel && (
        <button
          type="button"
          onClick={onOpenModels}
          className="rounded-control border border-line-subtle bg-surface-900/60 px-2.5 py-2 text-left"
        >
          <span className="text-xs font-semibold text-ghost-100">
            {provider ? "Pick a local model" : "No local model in this browser"}
          </span>
          <span className="mt-0.5 block text-[11px] leading-relaxed text-fg-muted">
            {provider
              ? "Until then I still find the right sections and take you there — I just cannot explain them in my own words."
              : "This browser has neither a built-in model nor WebGPU, so I will navigate rather than explain."}
          </span>
        </button>
      )}

      {SUGGESTIONS.map((suggestion) => (
        <button
          key={suggestion}
          type="button"
          onClick={() => onAsk(suggestion)}
          className="rounded-control border border-line-subtle px-2.5 py-1.5 text-left text-xs text-ghost-100 transition-colors hover:border-line-gold hover:text-gold-200"
        >
          {suggestion}
        </button>
      ))}
    </div>
  );
}
