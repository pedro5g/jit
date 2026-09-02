import type { KnowledgeFacet, KnowledgeKind } from "../../../lib/copilot/core/entities/knowledge-entry";
import type { RouteId, SymbolId } from "../../../lib/copilot/core/value-objects/ids";
import { facetId, symbolPath } from "../../../lib/copilot/core/value-objects/ids";

/** Compiler-derived coverage metadata; no query vocabulary enters this stage. */
export function deriveFacets(input: {
  title: string;
  breadcrumb: string;
  routeId: RouteId;
  symbols: readonly SymbolId[];
  kind: KnowledgeKind;
  concepts?: readonly string[];
}): KnowledgeFacet[] {
  const facets = new Map<string, KnowledgeFacet>();
  const add = (facet: KnowledgeFacet) => facets.set(facet.id, facet);
  const trail = input.breadcrumb
    .split(" › ")
    .map((part) => part.trim())
    .filter(Boolean);

  add({ id: facetId("heading", input.title), label: input.title, source: "heading" });
  for (const concept of input.concepts ?? []) {
    add({ id: facetId("concept", concept), label: concept, source: "concept" });
  }
  if (trail[0]) add({ id: facetId("page", trail[0]), label: trail[0], source: "page" });

  const routeParts = input.routeId.replace(/^route\.docs\./, "").split(".");
  if (routeParts.length > 1) {
    const label = routeParts.slice(0, -1).join(" / ");
    add({ id: facetId("route", ...routeParts.slice(0, -1)), label, source: "route" });
  }

  for (const symbol of input.symbols) {
    const path = symbolPath(symbol);
    add({ id: facetId("symbol", path), label: path, source: "symbol" });
  }

  add({ id: facetId("kind", input.kind), label: input.kind, source: "kind" });
  return [...facets.values()].sort((left, right) => left.id.localeCompare(right.id));
}
