/**
 * Turning parsed artifacts back into the domain objects.
 *
 * One job that is not obvious: entries ship without their text, because an
 * entry's content is exactly the concatenation of its chunks and shipping both
 * would send the whole documentation twice. This puts it back.
 */
import type { ApiSymbol } from "../../core/entities/api-symbol";
import type { DocumentChunk } from "../../core/entities/document-chunk";
import type { KnowledgeEntry } from "../../core/entities/knowledge-entry";
import type { KnowledgeManifest } from "../../core/entities/manifest";
import type { RouteEntry } from "../../core/entities/route-entry";
import { artifactStale } from "../../core/errors/copilot-error";
import type { KnowledgeSource } from "../../core/repositories";

/** The artifacts as they come off the wire, before any of this runs. */
export interface RawArtifacts {
  manifest: KnowledgeManifest;
  entries: Omit<KnowledgeEntry, "content">[];
  chunks: DocumentChunk[];
  symbols: ApiSymbol[];
  routes: RouteEntry[];
}

export function hydrate(raw: RawArtifacts): KnowledgeSource {
  const chunksByEntry = new Map<string, DocumentChunk[]>();
  for (const chunk of raw.chunks) {
    const list = chunksByEntry.get(chunk.knowledgeId);
    if (list) list.push(chunk);
    else chunksByEntry.set(chunk.knowledgeId, [chunk]);
  }

  for (const list of chunksByEntry.values()) list.sort((left, right) => left.part - right.part);

  const entries: KnowledgeEntry[] = raw.entries.map((entry) => ({
    ...entry,
    content: (chunksByEntry.get(entry.id) ?? []).map((chunk) => chunk.content).join("\n\n"),
  }));

  return { manifest: raw.manifest, entries, chunks: raw.chunks, symbols: raw.symbols, routes: raw.routes };
}

/**
 * The check that turns a mismatched artifact set into an error message.
 *
 * These are separate files fetched separately, and a browser holding
 * `vectors.bin` from one build next to `chunks.json` from the next produces
 * results that parse perfectly and rank randomly. Counting is enough to catch
 * it: the manifest was written last, from the same arrays.
 */
export function assertConsistent(source: KnowledgeSource): void {
  const { counts } = source.manifest;

  if (counts.entries !== source.entries.length) {
    throw artifactStale(`${counts.entries} entries`, `${source.entries.length}`);
  }
  if (counts.chunks !== source.chunks.length) {
    throw artifactStale(`${counts.chunks} chunks`, `${source.chunks.length}`);
  }
  if (counts.symbols !== source.symbols.length) {
    throw artifactStale(`${counts.symbols} symbols`, `${source.symbols.length}`);
  }
}
