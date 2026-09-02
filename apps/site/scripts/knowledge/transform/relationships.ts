import type { KnowledgeEntry } from "../../../lib/copilot/core/entities/knowledge-entry";
import type {
  KnowledgeRelation,
  KnowledgeRelationKind,
  KnowledgeRelationSource,
} from "../../../lib/copilot/core/entities/knowledge-relation";
import type { KnowledgeId } from "../../../lib/copilot/core/value-objects/ids";

const MAX_PER_KIND = 6;

export interface RelationInput {
  entries: KnowledgeEntry[];
  entriesByPath: Map<string, KnowledgeEntry[]>;
  declared: Map<KnowledgeId, string[]>;
  references: Map<KnowledgeId, string[]>;
}

/** Builds deterministic, bounded neighbourhoods and updates legacy `related`. */
export function linkRelationships(input: RelationInput): KnowledgeRelation[] {
  const { entries, entriesByPath, declared, references } = input;
  const relations = new Map<string, KnowledgeRelation>();
  const byRoute = new Map<string, KnowledgeEntry[]>();
  const bySymbol = new Map<string, KnowledgeEntry[]>();
  const byFacet = new Map<string, KnowledgeEntry[]>();
  const pathByEntry = new Map<KnowledgeId, string>();

  const add = (
    from: KnowledgeEntry,
    to: KnowledgeEntry,
    kind: KnowledgeRelationKind,
    source: KnowledgeRelationSource
  ) => {
    if (from.id === to.id) return;
    const key = `${from.id}\0${kind}\0${to.id}`;
    if (!relations.has(key)) relations.set(key, { from: from.id, to: to.id, kind, source });
  };

  for (const [path, pathEntries] of entriesByPath) {
    for (const entry of pathEntries) pathByEntry.set(entry.id, path);
  }

  for (const entry of entries) {
    const route = byRoute.get(entry.routeId) ?? [];
    route.push(entry);
    byRoute.set(entry.routeId, route);
    for (const symbol of entry.symbols) {
      const list = bySymbol.get(symbol) ?? [];
      list.push(entry);
      bySymbol.set(symbol, list);
    }
    // A heading or page label is navigation metadata, not a shared concept.
    // "Performance" appears on many unrelated reference pages, and linking
    // all of those pages turns a useful neighbourhood into a contamination
    // fan-out. Only explicit compiler-derived concept labels create
    // same-concept edges; heading/page facets still remain available to the
    // coverage planner on the entry itself.
    for (const facet of entry.facets.filter((item) => item.source === "concept")) {
      const list = byFacet.get(facet.id) ?? [];
      list.push(entry);
      byFacet.set(facet.id, list);
    }
  }

  for (const routeEntries of byRoute.values()) {
    for (let index = 0; index < routeEntries.length; index += 1) {
      const entry = routeEntries[index];
      const parentTrail = entry.breadcrumb.split(" › ").slice(0, -1).join(" › ");
      const parent = routeEntries
        .slice(0, index)
        .reverse()
        .find((candidate) => candidate.breadcrumb === parentTrail);

      if (parent) {
        add(entry, parent, "parent", "heading-hierarchy");
        add(parent, entry, "child", "heading-hierarchy");
      }

      const previous = routeEntries[index - 1];
      const next = routeEntries[index + 1];
      if (previous) add(entry, previous, "same-route", "route-hierarchy");
      if (next) add(entry, next, "same-route", "route-hierarchy");
    }
  }

  const resolveTarget = (entry: KnowledgeEntry, target: string): KnowledgeEntry[] => {
    const [rawPath, anchor] = target.split("#");
    const path = rawPath || pathByEntry.get(entry.id);
    const candidates = path ? (entriesByPath.get(path) ?? []) : [];
    return anchor ? candidates.filter((candidate) => candidate.anchor === anchor) : candidates.slice(0, 1);
  };

  for (const entry of entries) {
    for (const target of declared.get(entry.id) ?? []) {
      for (const resolved of resolveTarget(entry, target)) add(entry, resolved, "related", "frontmatter");
    }
    for (const target of references.get(entry.id) ?? []) {
      for (const resolved of resolveTarget(entry, target)) add(entry, resolved, "reference", "mdx-link");
    }
  }

  for (const sharing of bySymbol.values()) {
    if (sharing.length > 20) continue;
    for (const entry of sharing) {
      for (const target of sharing.slice(0, MAX_PER_KIND)) add(entry, target, "same-symbol", "shared-symbol");
    }
  }

  for (const sharing of byFacet.values()) {
    if (sharing.length < 2 || sharing.length > 12) continue;
    for (const entry of sharing) {
      for (const target of sharing.slice(0, MAX_PER_KIND)) add(entry, target, "same-concept", "derived-concept");
    }
  }

  const result = [...relations.values()].sort(
    (left, right) =>
      left.from.localeCompare(right.from) || left.kind.localeCompare(right.kind) || left.to.localeCompare(right.to)
  );

  const outgoing = new Map<KnowledgeId, KnowledgeId[]>();
  for (const relation of result) {
    const list = outgoing.get(relation.from) ?? [];
    if (!list.includes(relation.to) && list.length < MAX_PER_KIND) list.push(relation.to);
    outgoing.set(relation.from, list);
  }
  for (const entry of entries) entry.related = outgoing.get(entry.id) ?? [];

  return result;
}
