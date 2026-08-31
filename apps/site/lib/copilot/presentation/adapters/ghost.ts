import type { CopilotAction } from "../../core/entities/answer";
import type { AuditFinding } from "../../core/entities/audit";
import type { ContextEvidence } from "../../core/entities/model-context";
import type { RouteRepository } from "../../core/repositories";
import type { Locale } from "../../core/value-objects/locale";

/** The small view model the existing Ghost components render. */
export interface GhostSource {
  url: string;
  page: string;
  heading: string;
  breadcrumb: string;
  part: number;
  text: string;
}

export type GhostAction =
  | { kind: "navigate"; url: string; label: string }
  | { kind: "highlight"; heading: string; label: string }
  | { kind: "workspace"; code: string; mode: "run" | "generate"; label: string }
  | { kind: "demo"; code: string; near?: string; label: string };

export interface GhostPerformedAction {
  label: string;
  kind: GhostAction["kind"];
  undo?: () => void;
}

export function ghostSources(
  evidence: readonly ContextEvidence[],
  routes: RouteRepository,
  locale: Locale
): GhostSource[] {
  return evidence.flatMap((item) => {
    const base = routes.resolve(item.routeId, locale);
    if (!base) return [];

    return [
      {
        url: item.anchor ? `${base}#${item.anchor}` : base,
        page: item.breadcrumb.split("›")[0]?.trim() || item.title,
        heading: item.title,
        breadcrumb: item.breadcrumb,
        part: item.index,
        text: item.content,
      },
    ];
  });
}

export function ghostActions(
  actions: readonly CopilotAction[],
  routes: RouteRepository,
  locale: Locale
): GhostAction[] {
  const resolved: GhostAction[] = [];

  for (const action of actions) {
    if (action.type === "highlight") {
      resolved.push({ kind: "highlight", heading: action.heading, label: action.label });
      continue;
    }

    const base = routes.resolve(action.routeId, locale);
    if (!base) continue;
    const url = action.anchor ? `${base}#${action.anchor}` : base;
    resolved.push({ kind: "navigate", url, label: action.label });
  }

  return resolved;
}

export function isSevere(finding: AuditFinding): boolean {
  return finding.severity === "fatal";
}

export function workspaceActionFor(code: string, language: string): GhostAction | null {
  if (!/^(ts|tsx|typescript|js|javascript)?$/i.test(language)) return null;
  if (!/\bJIT\./.test(code)) return null;

  const generates = /JIT\.(validate|compare|security|json|binary|clone|update|map|cqrs)\b/.test(code);
  return {
    kind: "workspace",
    code,
    mode: generates ? "run" : "generate",
    label: generates ? "Run it in the workspace" : "Open in the workspace",
  };
}

export function codeActionFrom(answer: string): GhostAction | null {
  const pattern = /```([a-zA-Z0-9]*)\n?([\s\S]*?)```/g;
  let best: GhostAction | null = null;
  let bestLength = 0;

  for (const match of answer.matchAll(pattern)) {
    const code = (match[2] ?? "").trim();
    const action = workspaceActionFor(code, match[1] ?? "");
    if (action?.kind !== "workspace" || code.length <= bestLength) continue;
    best = action;
    bestLength = code.length;
  }

  return best;
}

export function demoActionFor(action: GhostAction | null, currentUrl: string): GhostAction | null {
  if (action?.kind !== "workspace" || !currentUrl.startsWith("/docs")) return null;
  return { kind: "demo", code: action.code, label: "Show it in this page" };
}

export function mergeGhostActions(primary: readonly GhostAction[], fallback: readonly GhostAction[]): GhostAction[] {
  const key = (action: GhostAction) =>
    action.kind === "navigate"
      ? `go:${action.url}`
      : action.kind === "highlight"
        ? `show:${action.heading}`
        : action.kind;
  const merged = [...primary];
  const seen = new Set(primary.map(key));

  for (const action of fallback) {
    if (seen.has(key(action))) continue;
    seen.add(key(action));
    merged.push(action);
  }

  return merged.slice(0, 4);
}

export function asksToNavigate(question: string): boolean {
  return /\b(?:open|show me|take me|go to|where is|abra|abre|mostre|me mostra|leve|me leva|onde fica)\b/i.test(
    question
  );
}

export function planGhostActions(actions: readonly GhostAction[], currentPath: string, navigate: boolean) {
  const automatic: GhostAction[] = [];
  const offered: GhostAction[] = [];

  for (const action of actions) {
    if (action.kind === "highlight" || action.kind === "workspace") {
      automatic.push(action);
    } else if (action.kind === "navigate" && navigate && action.url.split("#")[0] !== currentPath) {
      automatic.push(action);
    } else {
      offered.push(action);
    }
  }

  return { automatic, offered };
}
