import type { ChunkId, KnowledgeId, RouteId, SymbolId } from "../value-objects/ids";
import type { Locale } from "../value-objects/locale";
import type { KnowledgeKind } from "./knowledge-entry";

/**
 * One retrievable slice of a knowledge entry.
 *
 * Chunks exist because of two hard limits that have nothing to do with each
 * other: an embedding model has a token window, and a small language model has
 * a context budget. An entry that fits both is one chunk and keeps its entry's
 * identity; one that does not is split at a boundary a reader would recognise.
 *
 * Everything a ranking or a citation needs is denormalized onto the chunk, so
 * retrieval never has to join back to the entry to score or explain a hit. The
 * entry is fetched once, at context-building time, for the chunks that won.
 */
export interface DocumentChunk {
  id: ChunkId;
  knowledgeId: KnowledgeId;
  locale: Locale;

  title: string;
  breadcrumb: string;
  content: string;

  routeId: RouteId;
  anchor?: string;

  kind: KnowledgeKind;
  dense: boolean;
  showsRemovedApis: boolean;

  symbols: SymbolId[];

  /** Position within the entry, so consecutive slices can be re-joined. */
  part: number;
  /** How many slices the entry produced; `part 0 of 1` is an intact entry. */
  parts: number;

  sourceFile: string;
  sourceHash: string;

  /**
   * Digest of exactly what was embedded, plus the model and pipeline version.
   *
   * Not the same as `sourceHash`: two chunks with identical text share an
   * embedding, and a chunk whose text is unchanged but whose embedding model
   * changed must be recomputed. Keying the cache on this makes both fall out
   * for free.
   */
  embeddingHash: string;
}
