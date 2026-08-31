/** Deterministic action planning for the Ghost UI — §63 and §82. */
import type { CopilotAction } from "../../core/entities/answer";
import type { RouteRepository } from "../../core/repositories";
import type { Locale } from "../../core/value-objects/locale";

export interface ResolvedNavigationAction {
  action: CopilotAction;
  path?: string;
}

export class NavigationController {
  constructor(
    private readonly routes: RouteRepository,
    private readonly locale: Locale
  ) {}

  resolve(action: CopilotAction): ResolvedNavigationAction | null {
    if (action.type === "highlight") return { action };

    const path = this.routes.resolve(action.routeId, this.locale);
    return path ? { action, path: action.anchor ? `${path}#${action.anchor}` : path } : null;
  }

  plan(actions: readonly CopilotAction[], readerAskedToNavigate: boolean) {
    const resolved = actions
      .map((action) => this.resolve(action))
      .filter((action): action is ResolvedNavigationAction => action !== null);

    return {
      automatic: resolved.filter(
        ({ action }) => action.type === "highlight" || (readerAskedToNavigate && action.type === "navigate")
      ),
      offered: resolved.filter(({ action }) => action.type === "navigate" && !readerAskedToNavigate),
    };
  }
}
