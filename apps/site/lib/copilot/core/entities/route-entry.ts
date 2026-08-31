import type { RouteId } from "../value-objects/ids";
import type { Locale } from "../value-objects/locale";

/**
 * A page, described independently of the URL it is served from.
 *
 * The registry is an allowlist as much as a map: §82 of the plan says only a
 * registered RouteId may be navigated to, and this is the register. A model
 * that emits `route.docs.made.up` produces a lookup miss, not a navigation.
 */
export interface RouteEntry {
  id: RouteId;
  /**
   * The path template, without any locale prefix — `/docs/reference/functions/string`.
   * `RouteRepository.resolve` is what adds a prefix, if the site has one.
   */
  path: string;
  /** Nav title, for the label on a navigation action. */
  title: string;
  /** Locales this page actually exists in. */
  locales: Locale[];
  /** Section of the site, for grouping in the debug panel. */
  group: "docs" | "workspace" | "marketing";
}
