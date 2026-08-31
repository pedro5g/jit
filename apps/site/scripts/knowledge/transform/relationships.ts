/**
 * Which entries belong next to which.
 *
 * Two sources, and neither of them is a hand-weighted graph — that is the
 * thing being removed. §111: if it can be extracted, extract it.
 *
 *   `related:` frontmatter — a page-to-page link an author declared. The
 *   boundary guide belonging next to the DTO reference is a judgement no
 *   extractor makes, and it is cheap for an author to state.
 *
 *   shared symbols — two passages documenting `JIT.validate.safeParse` are
 *   related whether or not anyone said so, and this is where almost all of the
 *   real edges come from.
 *
 * The result is used for one thing only: giving the context builder somewhere
 * to go when retrieval returns a single strong hit and nothing else. It is not
 * a ranking signal, because a relationship says two things are adjacent, not
 * that either answers the question.
 */
import type { KnowledgeEntry } from "../../../lib/copilot/core/entities/knowledge-entry";
import type { KnowledgeId } from "../../../lib/copilot/core/value-objects/ids";

/** How many related entries any one entry keeps. Beyond this it is a list, not a link. */
const MAX_RELATED = 6;

export interface RelationInput {
  entries: KnowledgeEntry[];
  /** Site path -> the entries on that page, for resolving `related:` targets. */
  entriesByPath: Map<string, KnowledgeEntry[]>;
  /** Declared page links, by entry id. */
  declared: Map<KnowledgeId, string[]>;
}

export function linkRelationships({ entries, entriesByPath, declared }: RelationInput): void {
  const bySymbol = new Map<string, KnowledgeEntry[]>();
  for (const entry of entries) {
    for (const symbol of entry.symbols) {
      const list = bySymbol.get(symbol) ?? [];
      list.push(entry);
      bySymbol.set(symbol, list);
    }
  }

  for (const entry of entries) {
    const scored = new Map<KnowledgeId, number>();

    // A declared page link outranks anything derived: the author was making a
    // statement, and there are only a few dozen of them site-wide.
    for (const path of declared.get(entry.id) ?? []) {
      for (const target of entriesByPath.get(path) ?? []) {
        if (target.id !== entry.id) scored.set(target.id, 100 + (target.anchor ? 0 : 1));
      }
    }

    /**
     * A symbol shared by half the site says nothing.
     *
     * `JIT.object` appears in ninety passages; two of them sharing it is not
     * evidence they belong together. The weight is the inverse of how common
     * the symbol is, which is idf by another name and for the same reason.
     */
    for (const symbol of entry.symbols) {
      const sharing = bySymbol.get(symbol) ?? [];
      if (sharing.length > 20) continue;

      for (const target of sharing) {
        if (target.id === entry.id) continue;
        scored.set(target.id, (scored.get(target.id) ?? 0) + 1 / sharing.length);
      }
    }

    entry.related = [...scored.entries()]
      .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
      .slice(0, MAX_RELATED)
      .map(([id]) => id);
  }
}
