import type { RetrievedSection } from "./types";

/**
 * What the ghost can do besides talk.
 *
 * Two rules shaped this protocol. First, a 0.8B model will not reliably emit
 * JSON tool calls, so the only thing it has to invent is a single-line tag —
 * and if it forgets, retrieval still produces the navigation action on its
 * own. Second, code actions ride on ordinary fenced blocks, which the model
 * already writes correctly, so "run this in the workspace" never depends on
 * the model cooperating with a syntax at all.
 */

export type AssistantAction =
  | { kind: "navigate"; url: string; label: string }
  | { kind: "highlight"; heading: string; label: string }
  | { kind: "workspace"; code: string; mode: "run" | "generate"; label: string }
  /** Rewrites the example on the docs page the reader is looking at. */
  | { kind: "demo"; code: string; near?: string | undefined; label: string };

// The horizontal space before a tag belongs to the tag: swallowing it keeps
// "look here [[go:/docs/x]]" from leaving a trailing space, while a tag in the
// middle of a sentence still leaves the single space that follows it.
const TAG = /[ \t]*\[\[(go|show):([^\]]{1,200})\]\]/g;

/** Only same-origin documentation paths — a tag can never point off-site. */
function isSafeDocPath(url: string): boolean {
  return /^\/(docs|workspace|playground|lab|benchmarks)(\/|#|$)/.test(url);
}

/**
 * Pages the ghost is allowed to name. A model that invents an API name also
 * invents a path, and an invented path is worse than a missing one: the reader
 * is carried somewhere that has nothing to do with the question, and the
 * destination retrieval actually found never gets a chance. Only paths that
 * exist in the index survive.
 */
export interface ActionContext {
  knownPages: ReadonlySet<string>;
}

function isKnownPage(url: string, context: ActionContext | undefined): boolean {
  if (!context) return true;
  return context.knownPages.has(url.split("#")[0]);
}

export interface ParsedAnswer {
  /** The answer with action tags removed, ready to render. */
  text: string;
  actions: AssistantAction[];
}

/**
 * Strips action tags out of the model's prose and returns them separately.
 * Runs on every streamed frame, so a half-written tag must not flash on
 * screen: an unterminated `[[` at the end is held back until it completes.
 */
export function parseActions(answer: string, context?: ActionContext): ParsedAnswer {
  const actions: AssistantAction[] = [];
  const seen = new Set<string>();

  let text = answer.replace(TAG, (_match, kind: string, payload: string) => {
    const value = payload.trim();
    if (!value) return "";

    if (kind === "go" && isSafeDocPath(value) && isKnownPage(value, context)) {
      const key = `go:${value}`;
      if (!seen.has(key)) {
        seen.add(key);
        actions.push({ kind: "navigate", url: value, label: labelForUrl(value) });
      }
    }

    if (kind === "show") {
      const key = `show:${value}`;
      if (!seen.has(key)) {
        seen.add(key);
        actions.push({ kind: "highlight", heading: value, label: `Point at "${value}"` });
      }
    }

    return "";
  });

  // hold back a tag that is still streaming in
  const openTag = text.lastIndexOf("[[");
  if (openTag !== -1 && !text.slice(openTag).includes("]]")) text = text.slice(0, openTag);

  return { text: text.replace(/[ \t]+\n/g, "\n").trim(), actions };
}

/** `/docs/runtime/queries#filtering` -> `Queries · filtering`. */
function labelForUrl(url: string): string {
  const [path, anchor] = url.split("#");
  const last = path.split("/").filter(Boolean).pop() ?? "docs";
  const page = last.replace(/-/g, " ").replace(/^./, (character) => character.toUpperCase());

  return anchor ? `${page} · ${anchor.replace(/-/g, " ")}` : page;
}

/**
 * The navigation the ghost offers even when the model emits nothing useful —
 * or when there is no model at all. Retrieval already knows the best section,
 * so pointing at it needs no inference.
 */
export function deriveActions(
  sources: RetrievedSection[],
  currentUrl: string,
  /** Where the concept graph would send them when retrieval found nothing. */
  fallbackPage?: string | undefined
): AssistantAction[] {
  const best = sources[0];
  if (!best) {
    // retrieval missed, but the graph still recognised the subject
    if (!fallbackPage || fallbackPage === currentUrl.split("#")[0]) return [];
    return [{ kind: "navigate", url: fallbackPage, label: `Take me to ${labelForUrl(fallbackPage)}` }];
  }

  const onThisPage = best.section.url.split("#")[0] === currentUrl.split("#")[0];

  return [
    onThisPage
      ? { kind: "highlight", heading: best.section.heading, label: `Point at "${best.section.heading}"` }
      : { kind: "navigate", url: best.section.url, label: `Take me to ${labelForUrl(best.section.url)}` },
  ];
}

/** Merges model actions with derived ones, without repeating a destination. */
export function mergeActions(fromModel: AssistantAction[], derived: AssistantAction[]): AssistantAction[] {
  const keyOf = (action: AssistantAction) =>
    action.kind === "navigate"
      ? `go:${action.url}`
      : action.kind === "highlight"
        ? `show:${action.heading}`
        : action.kind;

  const merged = [...fromModel];
  const keys = new Set(merged.map(keyOf));

  for (const action of derived) {
    if (!keys.has(keyOf(action))) merged.push(action);
  }

  return merged.slice(0, 4);
}

/**
 * A jit code block is a runnable thing, so every one the ghost writes gets the
 * workspace attached to it. Blocks that are plainly not jit source — a shell
 * command, a JSON payload — are left alone.
 */
export function workspaceActionFor(code: string, language: string): AssistantAction | null {
  if (!/^(ts|tsx|typescript|js|javascript)?$/i.test(language)) return null;
  if (!/\bJIT\./.test(code)) return null;

  const generates = /JIT\.(validate|compare|security|json|binary|clone|update|map|query)\b/.test(code);

  return {
    kind: "workspace",
    code,
    mode: generates ? "run" : "generate",
    label: generates ? "Run it in the workspace" : "Open in the workspace",
  };
}

/**
 * The one code block from an answer worth putting in the editor.
 *
 * An answer often shows a fragment to explain a point and then the real thing;
 * writing every block in turn would leave the editor holding whichever came
 * last rather than the one that compiles. The longest jit block is that one in
 * practice, and a single write keeps the undo banner meaningful.
 */
export function codeActionFrom(answer: string): AssistantAction | null {
  const pattern = /```([a-zA-Z0-9]*)\n?([\s\S]*?)```/g;
  let best: AssistantAction | null = null;
  let bestLength = 0;

  for (const match of answer.matchAll(pattern)) {
    const code = (match[2] ?? "").trim();
    const action = workspaceActionFor(code, match[1] ?? "");
    if (!action || code.length <= bestLength) continue;

    best = action;
    bestLength = code.length;
  }

  return best;
}

/**
 * The same code, offered as a demonstration in place. Only on a docs page:
 * there is no example to rewrite anywhere else, and in the workspace the
 * editor is the better destination.
 */
export function demoActionFor(action: AssistantAction | null, currentUrl: string): AssistantAction | null {
  if (action?.kind !== "workspace") return null;
  if (!currentUrl.startsWith("/docs")) return null;

  return { kind: "demo", code: action.code, label: "Show it in this page" };
}

export interface ActionPlan {
  /** Carried out without asking, because they are cheap and reversible. */
  auto: AssistantAction[];
  /** Left as a button, because doing them unasked would interrupt. */
  offered: AssistantAction[];
}

export interface PlanOptions {
  /**
   * The reader asked to be taken somewhere — "me leva lá", "abre a página",
   * "onde fica isso". Only then is navigating what they wanted.
   */
  readerAskedToNavigate?: boolean;
}

/**
 * How much the ghost may do on its own, decided by what the reader asked for.
 *
 * Navigating used to be the default, and it was the wrong default. A reader
 * who asks "pq a jit é rápida" wants an answer, not a page change: the ghost
 * would explain something and simultaneously pull the documentation out from
 * under them, so the answer they were reading scrolled away and the thing they
 * were reading before it was lost. Every exchange ended with "took you to …"
 * whether or not going anywhere helped.
 *
 * So the destination is offered as a link in the conversation instead, and
 * only carried out when the reader actually asked to go somewhere. Pointing at
 * a heading on the page they are already on stays automatic — it moves nothing
 * and it is the cheapest way to answer "where does it say that".
 */
export function planActions(actions: AssistantAction[], currentUrl: string, options: PlanOptions = {}): ActionPlan {
  const inWorkspace = currentUrl.startsWith("/workspace");
  const plan: ActionPlan = { auto: [], offered: [] };

  for (const action of actions) {
    if (action.kind === "highlight") {
      plan.auto.push(action);
      continue;
    }

    // Rewriting the page is always the reader's call. Documentation they cannot
    // tell apart from a suggestion is worth less than the demonstration gains.
    if (action.kind === "demo") {
      plan.offered.push(action);
      continue;
    }

    if (action.kind === "navigate") {
      const samePage = action.url.split("#")[0] === currentUrl.split("#")[0];
      const wanted = options.readerAskedToNavigate && !inWorkspace && !samePage;
      if (wanted) plan.auto.push(action);
      else plan.offered.push(action);
      continue;
    }

    if (inWorkspace) plan.auto.push(action);
    else plan.offered.push(action);
  }

  return plan;
}
