import type { RouteId } from "../value-objects/ids";
import type { Locale } from "../value-objects/locale";
import type { AuditResult } from "./audit";
import type { ContextEvidence } from "./model-context";

/**
 * What the copilot can do besides talk.
 *
 * §63: the front end receives structured objects, never textual instructions.
 * "go to the uuid docs" is a sentence a component has to parse and can get
 * wrong; `{ type: "navigate", routeId }` is a value it can act on.
 *
 * And §47: no action carries a URL, a DOM selector or a function. A navigate
 * action carries a RouteId, which the route repository either resolves or does
 * not — there is no path through this protocol that reaches an arbitrary
 * destination.
 */
export type CopilotAction =
  | { type: "navigate"; routeId: RouteId; anchor?: string; label: string }
  | { type: "highlight"; heading: string; label: string };

/** One numbered source, resolved to something the UI can link to. */
export interface AnswerCitation {
  index: number;
  routeId: RouteId;
  /** The resolved public path, or undefined if the route is not served here. */
  path?: string;
  breadcrumb: string;
}

export interface CopilotAnswer {
  /** The prose, with action tags stripped out. */
  text: string;
  locale: Locale;
  actions: CopilotAction[];
  citations: AnswerCitation[];
  evidence: ContextEvidence[];
  audit: AuditResult;
  /**
   * The answer was regenerated once after a failed audit, and this is the
   * second attempt (§58). Surfaced because a reader deserves to know, and
   * because §73's retry-success rate is measured from it.
   */
  retried: boolean;
  /**
   * Nothing in the documentation covered the question.
   *
   * Distinct from a failed audit: the model did the right thing, and the UI
   * should present this as an honest answer rather than as a rejection.
   */
  insufficientEvidence: boolean;
  timings: { retrievalMs: number; contextMs: number; generationMs: number; auditMs: number };
}
