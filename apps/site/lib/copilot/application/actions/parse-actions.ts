/**
 * Turning the model's one-line tags into structured actions.
 *
 * The vocabulary is deliberately one line long. A model this size will not
 * reliably emit JSON tool calls — it emits something JSON-shaped that fails to
 * parse, and then the action is lost entirely. A `[[go:route.docs.x]]` either
 * appears or does not, and when it does not, the navigation is recovered from
 * retrieval instead. The ghost stays useful even when the model refuses to
 * cooperate with the syntax at all.
 *
 * Two rules make this safe rather than merely convenient:
 *
 *   a route id is parsed, not trusted — a malformed one never becomes a
 *   RouteId, so it cannot reach the router;
 *
 *   a route the answer was not shown is dropped — §82's allowlist is the
 *   sources, not the whole registry, because a model naming a real page it
 *   never saw is guessing.
 */
import type { CopilotAction } from "../../core/entities/answer";
import type { ContextEvidence } from "../../core/entities/model-context";
import type { RouteRepository } from "../../core/repositories";
import { parseRouteId, type RouteId } from "../../core/value-objects/ids";
import type { Locale } from "../../core/value-objects/locale";

/**
 * The horizontal space before a tag belongs to the tag.
 *
 * Swallowing it stops "look here [[go:route.docs.x]]" leaving a trailing
 * space, while a tag mid-sentence still leaves the single space after it.
 */
const TAG = /[ \t]*\[\[(go|show):([^\]]{1,200})\]\]/g;

/**
 * An unterminated tag at the very end of a streaming frame.
 *
 * Every frame is parsed as it arrives, so a half-written `[[go:route.d` would
 * flash on screen as literal text and then vanish. Held back until it closes.
 */
const PARTIAL_TAG = /\[\[[^\]]*$/;

export interface ParseActionsInput {
  answer: string;
  evidence: readonly ContextEvidence[];
  routes: RouteRepository;
  locale: Locale;
  /** True while the answer is still arriving, so partial tags are held back. */
  streaming?: boolean;
}

export interface ParsedAnswer {
  /** The prose, ready to render. */
  text: string;
  actions: CopilotAction[];
  /** Route ids the model named that it was never shown. */
  rejected: string[];
}

export function parseActions(input: ParseActionsInput): ParsedAnswer {
  const allowed = new Map<string, ContextEvidence>();
  for (const evidence of input.evidence) allowed.set(evidence.routeId, evidence);

  const actions: CopilotAction[] = [];
  const rejected: string[] = [];
  const seen = new Set<string>();

  let text = input.answer.replace(TAG, (_match, kind: string, payload: string) => {
    const value = payload.trim();
    if (!value || seen.has(`${kind}:${value}`)) return "";
    seen.add(`${kind}:${value}`);

    if (kind === "show") {
      actions.push({ type: "highlight", heading: value, label: `Point at "${value}"` });
      return "";
    }

    const routeId = parseRouteId(value);
    const evidence = routeId ? allowed.get(routeId) : undefined;

    if (!routeId || !evidence) {
      rejected.push(value);
      return "";
    }

    actions.push({
      type: "navigate",
      routeId,
      ...(evidence.anchor ? { anchor: evidence.anchor } : {}),
      label: labelFor(routeId, evidence.breadcrumb),
    });

    return "";
  });

  if (input.streaming) text = text.replace(PARTIAL_TAG, "");

  return { text: text.trim(), actions, rejected };
}

/**
 * A navigation action retrieval produced on its own.
 *
 * The model forgetting the tag is the common case, not the exception, and the
 * reader still wants the link. The best source is a better destination than
 * nothing, and it costs the model no cooperation at all.
 */
export function fallbackNavigation(
  evidence: readonly ContextEvidence[],
  existing: readonly CopilotAction[]
): CopilotAction | null {
  const best = evidence[0];
  if (!best) return null;
  if (existing.some((action) => action.type === "navigate")) return null;

  return {
    type: "navigate",
    routeId: best.routeId,
    ...(best.anchor ? { anchor: best.anchor } : {}),
    label: labelFor(best.routeId, best.breadcrumb),
  };
}

/** `route.docs.reference.functions.mask` plus a breadcrumb, as a button label. */
function labelFor(routeId: RouteId, breadcrumb: string): string {
  const page = breadcrumb.split("›")[0]?.trim();
  return page ? `Open ${page}` : `Open ${routeId}`;
}
