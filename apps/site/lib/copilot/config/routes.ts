import type { RouteEntry } from "../core/entities/route-entry";
import { type RouteId, routeId, slugSegment } from "../core/value-objects/ids";
import { DEFAULT_LOCALE, type Locale } from "../core/value-objects/locale";

/**
 * Every place the copilot is allowed to send a reader.
 *
 * Two halves, for two different reasons.
 *
 * The documentation half is *derived*: `content/docs/reference/functions/string.mdx`
 * becomes `route.docs.reference.functions.string` by a rule, not by an entry in
 * a list. A hand-written map of 87 pages is a map that is wrong the first time
 * someone adds a page and forgets, and "the ghost cannot link to the page you
 * just wrote" is a failure nobody notices for weeks. The rule cannot forget.
 *
 * The application half is declared, because there is no file to derive it from
 * and there are six of them.
 *
 * Nothing else is navigable. A model that emits `route.docs.made.up` produces
 * a lookup miss rather than a navigation, which is the entire security model
 * for agent navigation (§82) — there is no path through the action protocol
 * that carries a URL.
 */

/** Where the MDX lives, relative to `apps/site`. */
export const DOCS_CONTENT_DIR = "content/docs";

/**
 * Whether public paths carry a locale prefix.
 *
 * The plan wants `/en/docs/…` and `/pt-BR/docs/…` eventually (§12). The site
 * serves `/docs/…` today and the content is English-only, so resolving with a
 * prefix now would produce 404s in every navigation action. The seam is here,
 * unused, so turning it on is one flag and a Next route group rather than a
 * change to every citation, every eval fixture and every stored artifact.
 */
export const LOCALIZE_PATHS = false;

interface StaticRoute {
  segments: string[];
  path: string;
  title: string;
  group: RouteEntry["group"];
}

const STATIC: StaticRoute[] = [
  { segments: ["home"], path: "/", title: "JIT", group: "marketing" },
  { segments: ["benchmarks"], path: "/benchmarks", title: "Benchmarks", group: "marketing" },
  {
    segments: ["benchmarks", "methodology"],
    path: "/benchmarks/methodology",
    title: "Benchmark methodology",
    group: "marketing",
  },
  { segments: ["lab"], path: "/lab", title: "Lab", group: "workspace" },
  { segments: ["playground"], path: "/playground", title: "Playground", group: "workspace" },
  { segments: ["workspace"], path: "/workspace", title: "Workspace", group: "workspace" },
];

export const STATIC_ROUTES: RouteEntry[] = STATIC.map((route) => ({
  id: routeId(...route.segments),
  path: route.path,
  title: route.title,
  locales: [DEFAULT_LOCALE],
  group: route.group,
}));

/** Handy constants for code that navigates on its own. */
export const Routes = {
  home: routeId("home"),
  docs: routeId("docs"),
  lab: routeId("lab"),
  playground: routeId("playground"),
  workspace: routeId("workspace"),
  benchmarks: routeId("benchmarks"),
} as const;

/**
 * `reference/functions/string.mdx` -> the route id and the path it is served at.
 *
 * Shared by the knowledge compiler, which walks the content tree, and by the
 * runtime, which has to turn the page a reader is on back into a RouteId. Two
 * implementations of this rule would drift, and the symptom would be a
 * "current page" signal that silently never matches.
 */
export function docRoute(relativeFile: string): { id: RouteId; path: string; slug: string[] } {
  const withoutExtension = relativeFile.replace(/\\/g, "/").replace(/\.mdx$/, "");
  const slug = withoutExtension.split("/").filter((part) => part && part !== "index");

  return {
    id: routeId("docs", ...slug),
    path: slug.length > 0 ? `/docs/${slug.join("/")}` : "/docs",
    slug,
  };
}

/** `/docs/reference/functions/string` -> `route.docs.reference.functions.string`. */
export function routeIdForPath(path: string): RouteId | null {
  const clean = path.split("#")[0].split("?")[0].replace(/\/+$/, "") || "/";

  const staticMatch = STATIC_ROUTES.find((route) => route.path === clean);
  if (staticMatch) return staticMatch.id;

  if (clean === "/docs") return routeId("docs");
  if (!clean.startsWith("/docs/")) return null;

  const slug = clean.slice("/docs/".length).split("/").filter(Boolean);
  if (slug.length === 0) return null;

  // A path segment that does not survive slugification is not one of ours —
  // it cannot have come from a file whose id we derived the same way.
  if (slug.some((segment) => slugSegment(segment) !== segment)) return null;

  return routeId("docs", ...slug);
}

/**
 * The public URL for a route.
 *
 * Takes the locale even though it currently ignores it, because the call sites
 * are the expensive part to change later and there are already a dozen of them.
 */
export function resolvePath(path: string, locale: Locale): string {
  if (!LOCALIZE_PATHS) return path;
  return path === "/" ? `/${locale}` : `/${locale}${path}`;
}

/** Titles for the six application routes, for a navigation action's label. */
export function staticRouteTitle(id: RouteId): string | undefined {
  return STATIC_ROUTES.find((route) => route.id === id)?.title;
}
