/**
 * Every page the copilot may send a reader to.
 *
 * Derived from the content tree plus the six application routes, never written
 * by hand. The registry doubles as the navigation allowlist (§82), so a page
 * missing from here is a page the ghost cannot link to — which makes "derived"
 * the only maintainable option: a hand-written list is wrong the first time
 * someone adds a page, and nobody notices for weeks.
 */

import { docRoute, STATIC_ROUTES } from "../../../lib/copilot/config/routes";
import type { RouteEntry } from "../../../lib/copilot/core/entities/route-entry";
import { DEFAULT_LOCALE } from "../../../lib/copilot/core/value-objects/locale";
import type { SourceFile } from "../discover";
import { parseFrontmatter } from "./docs";

export interface RouteExtraction {
  routes: RouteEntry[];
  /** Site path -> route, for resolving `related:` frontmatter targets. */
  byPath: Map<string, RouteEntry>;
}

export async function extractRoutes(
  files: SourceFile[],
  read: (file: SourceFile) => Promise<string>
): Promise<RouteExtraction> {
  const routes: RouteEntry[] = [...STATIC_ROUTES];

  for (const file of files) {
    const { id, path } = docRoute(file.relative);
    const { data } = parseFrontmatter(await read(file));

    routes.push({
      id,
      path,
      title: data.title ?? file.relative.replace(/\.mdx$/, ""),
      // Every page exists in English today. When a translation lands, the
      // compiler will see a second file and add its locale here — which is why
      // this is a list rather than a boolean.
      locales: [DEFAULT_LOCALE],
      group: "docs",
    });
  }

  routes.sort((left, right) => left.id.localeCompare(right.id));

  return { routes, byPath: new Map(routes.map((route) => [route.path, route])) };
}
