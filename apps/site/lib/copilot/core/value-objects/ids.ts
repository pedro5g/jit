/**
 * Identity in the knowledge engine — and why none of it is a URL.
 *
 * The old assistant identified a passage by the path it happened to be served
 * from, which made every rename a silent data migration: cached embeddings
 * keyed by URL, eval expectations quoting URLs, citations pointing at pages
 * that had moved. Renaming `/docs/reference/functions/string` would have
 * invalidated the vector cache and broken half the gold set, so nothing was
 * ever renamed.
 *
 * So identity is separate from location. A `RouteId` names a page, a
 * `RouteRepository` says where that page is served today, and the two can
 * change independently. Same for knowledge and symbols: the id survives the
 * rewrite of the paragraph it came from, which is what lets an embedding be
 * reused and an eval case stay meaningful.
 *
 * Every id is prefixed with its kind. A citation list mixes all three, and
 * `symbol.jit.string.uuid` next to `route.docs.reference.functions.string`
 * reads correctly with no accompanying type tag.
 */

declare const brand: unique symbol;

type Branded<Kind extends string> = string & { readonly [brand]: Kind };

/** A canonical unit of documented knowledge — one concept, guide or example. */
export type KnowledgeId = Branded<"KnowledgeId">;

/** One retrievable slice of a knowledge entry. */
export type ChunkId = Branded<"ChunkId">;

/** A public API name at any of the three levels. */
export type SymbolId = Branded<"SymbolId">;

/** A page, independent of the path it is served from. */
export type RouteId = Branded<"RouteId">;

export const KNOWLEDGE_PREFIX = "knowledge.";
export const CHUNK_PREFIX = "chunk.";
export const SYMBOL_PREFIX = "symbol.";
export const ROUTE_PREFIX = "route.";

/**
 * The characters an id segment may contain.
 *
 * Lowercase, digits and hyphens, joined by dots. Deliberately narrow: ids end
 * up in filenames (the embedding cache), in JSON keys, in eval fixtures and in
 * whatever the model emits for a navigation action. A segment that needs
 * escaping in any one of those places is a segment that will eventually be
 * escaped wrong.
 */
const SEGMENT = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function isWellFormed(value: string, prefix: string): boolean {
  if (!value.startsWith(prefix)) return false;

  const rest = value.slice(prefix.length);
  if (!rest) return false;

  return rest.split(".").every((segment) => SEGMENT.test(segment));
}

/**
 * Turns arbitrary text into one id segment.
 *
 * Used on headings and file names, both of which contain things a segment may
 * not: backticks, spaces, `.mdx`, accents. Accents are folded rather than
 * dropped so a Portuguese heading and its unaccented spelling land on the same
 * id — otherwise "validação" and "validacao" would be two different concepts.
 */
export function slugSegment(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function join(prefix: string, segments: readonly string[]): string {
  const parts = segments.map(slugSegment).filter(Boolean);
  if (parts.length === 0)
    throw new Error(`cannot build an id from ${JSON.stringify(segments)} — every segment is empty`);

  return prefix + parts.join(".");
}

export function knowledgeId(...segments: string[]): KnowledgeId {
  return join(KNOWLEDGE_PREFIX, segments) as KnowledgeId;
}

export function chunkId(...segments: string[]): ChunkId {
  return join(CHUNK_PREFIX, segments) as ChunkId;
}

export function routeId(...segments: string[]): RouteId {
  return join(ROUTE_PREFIX, segments) as RouteId;
}

/**
 * A symbol id, which is the one kind that must NOT be slugified.
 *
 * `safeParse` and `safe-parse` are different names, and the whole point of the
 * symbol index is that `JIT.validate.safeParse` maps to exactly one entry. So
 * the dotted path is preserved verbatim after the prefix, and casing carries
 * meaning. `symbol.jit.validate.safeParse` is the id; the lookup that has to
 * be case-insensitive lowercases at query time, not here.
 */
export function symbolId(path: string): SymbolId {
  const trimmed = path.trim().replace(/^JIT\./i, "jit.");
  if (!/^[A-Za-z_$][A-Za-z0-9_$]*(?:\.[A-Za-z_$][A-Za-z0-9_$]*)*$/.test(trimmed)) {
    throw new Error(`${JSON.stringify(path)} is not a symbol path`);
  }

  return (SYMBOL_PREFIX + trimmed) as SymbolId;
}

/** `symbol.jit.string.uuid` -> `jit.string.uuid`, for display and matching. */
export function symbolPath(id: SymbolId): string {
  return id.slice(SYMBOL_PREFIX.length);
}

export const isKnowledgeId = (value: string): value is KnowledgeId => isWellFormed(value, KNOWLEDGE_PREFIX);
export const isChunkId = (value: string): value is ChunkId => isWellFormed(value, CHUNK_PREFIX);
export const isRouteId = (value: string): value is RouteId => isWellFormed(value, ROUTE_PREFIX);

export const isSymbolId = (value: string): value is SymbolId =>
  value.startsWith(SYMBOL_PREFIX) &&
  /^[A-Za-z_$][A-Za-z0-9_$]*(?:\.[A-Za-z_$][A-Za-z0-9_$]*)*$/.test(value.slice(SYMBOL_PREFIX.length));

/**
 * Parses an id the model produced, refusing anything malformed.
 *
 * Every id that crosses the boundary from a generated answer back into the
 * engine goes through one of these. A navigation action carrying
 * `route.../../etc/passwd` never reaches the router, because it never becomes
 * a RouteId in the first place.
 */
export function parseRouteId(value: string): RouteId | null {
  return isRouteId(value) ? value : null;
}

export function parseSymbolId(value: string): SymbolId | null {
  return isSymbolId(value) ? value : null;
}

export function parseKnowledgeId(value: string): KnowledgeId | null {
  return isKnowledgeId(value) ? value : null;
}
