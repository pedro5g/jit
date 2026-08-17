/**
 * How the ghost reaches the rest of the app.
 *
 * The assistant is mounted once, high in the tree, while the things it acts on
 * — the reading guide, the workspace editor — live wherever the route puts
 * them. Events keep that one-directional and loose: the assistant announces
 * what it wants, and whoever is on screen responds. Nothing breaks when the
 * listener is not mounted, which is exactly the case that has to be handled
 * (asking for the workspace from a docs page).
 */

export const HIGHLIGHT_EVENT = "jit:assistant-highlight";
export const WORKSPACE_WRITE_EVENT = "jit:workspace-write";
export const ASSISTANT_OPEN_EVENT = "jit:assistant-open";
export const SNIPPET_DEMO_EVENT = "jit:snippet-demo";

export interface HighlightDetail {
  /** Heading text to find on the current page. */
  heading: string;
}

export interface WorkspaceWriteDetail {
  code: string;
  mode: "run" | "generate";
  /** Explains the edit in the workspace's undo banner. */
  reason: string;
  /**
   * Which file to write. The workspace holds a tree now, and an answer about
   * accounts belongs in `account-schemas.ts` rather than on top of whatever
   * file happened to be open. Absent means the file the reader is looking at.
   */
  path?: string | undefined;
}

/**
 * What the reader currently has in the editor. Module state rather than an
 * event, because the assistant needs it at the moment a question is asked
 * rather than whenever the editor last changed — and both live in the same
 * client bundle.
 */
let editorCode: string | null = null;

export function publishEditorCode(code: string | null) {
  editorCode = code;
}

/** Undefined when no workspace is open, which is most of the site. */
export function readEditorCode(): string | undefined {
  return editorCode ?? undefined;
}

/** Survives the navigation when the workspace is not mounted yet. */
const PENDING_KEY = "jit.workspace.pending";

export function requestHighlight(detail: HighlightDetail) {
  window.dispatchEvent(new CustomEvent(HIGHLIGHT_EVENT, { detail }));
}

/** Survives the navigation to the page the passage is on. */
const PENDING_HIGHLIGHT_KEY = "jit.docs.pending-highlight";

/**
 * Points at something on a page the reader is not on yet.
 *
 * Dispatching the event before navigating loses it: the page that would listen
 * has not mounted. So the request is parked, the route changes, and the guide
 * picks it up the moment it has an article to look in — which is what turns
 * "take me there" into being shown the passage rather than dropped at the top
 * of a page and left to search it.
 */
export function requestHighlightAfterNavigation(detail: HighlightDetail) {
  try {
    sessionStorage.setItem(PENDING_HIGHLIGHT_KEY, JSON.stringify(detail));
  } catch {
    // a blocked store costs the pointer, not the navigation
  }
}

export function takePendingHighlight(): HighlightDetail | null {
  try {
    const raw = sessionStorage.getItem(PENDING_HIGHLIGHT_KEY);
    if (!raw) return null;

    sessionStorage.removeItem(PENDING_HIGHLIGHT_KEY);
    return JSON.parse(raw) as HighlightDetail;
  } catch {
    return null;
  }
}

export interface SnippetDemoDetail {
  /** The variation to show in place of the example on the page. */
  code: string;
  /** Heading the example sits under, when the ghost named one. */
  near?: string | undefined;
}

/**
 * Rewrites an example on the page the reader is looking at, so a variation can
 * be shown where the original is rather than in a panel beside it.
 */
export function requestSnippetDemo(detail: SnippetDemoDetail) {
  window.dispatchEvent(new CustomEvent(SNIPPET_DEMO_EVENT, { detail }));
}

export function openAssistant(question?: string) {
  window.dispatchEvent(new CustomEvent(ASSISTANT_OPEN_EVENT, { detail: question ? { question } : {} }));
}

/**
 * Hands code to the workspace. If it is already open the edit is live;
 * otherwise it is parked and the caller navigates, so the code is applied the
 * moment the editor mounts.
 */
export function requestWorkspaceWrite(detail: WorkspaceWriteDetail): boolean {
  const delivered = window.dispatchEvent(new CustomEvent(WORKSPACE_WRITE_EVENT, { detail, cancelable: true }));

  // a mounted workspace calls preventDefault to claim the edit
  if (!delivered) return true;

  sessionStorage.setItem(PENDING_KEY, JSON.stringify(detail));
  return false;
}

/** Read once by the workspace when it mounts. */
export function takePendingWorkspaceWrite(): WorkspaceWriteDetail | null {
  const raw = sessionStorage.getItem(PENDING_KEY);
  if (!raw) return null;

  sessionStorage.removeItem(PENDING_KEY);
  try {
    return JSON.parse(raw) as WorkspaceWriteDetail;
  } catch {
    return null;
  }
}
