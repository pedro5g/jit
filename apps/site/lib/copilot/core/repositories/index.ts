import type { ApiSymbol } from "../entities/api-symbol";
import type { DocumentChunk } from "../entities/document-chunk";
import type { KnowledgeEntry } from "../entities/knowledge-entry";
import type { KnowledgeManifest } from "../entities/manifest";
import type { LexicalMatch, SymbolMatch, VectorMatch } from "../entities/retrieval";
import type { RouteEntry } from "../entities/route-entry";
import type { ChunkId, KnowledgeId, RouteId, SymbolId } from "../value-objects/ids";
import type { Locale } from "../value-objects/locale";

/**
 * The contracts the application layer is written against.
 *
 * Every one of these is synchronous. The artifacts are loaded once, up front,
 * by whoever constructs the repositories; making `findById` a promise would
 * push that decision into every call site and turn the ranking loop — which
 * runs over a few thousand chunks — into a promise storm for no benefit. The
 * asynchrony that genuinely exists (fetching, embedding, generating) lives in
 * the ports below, where it is real.
 */

export interface KnowledgeRepository {
  findById(id: KnowledgeId): KnowledgeEntry | undefined;
  findMany(ids: readonly KnowledgeId[]): KnowledgeEntry[];
  /** Entries documenting a symbol, best first. */
  bySymbol(id: SymbolId): KnowledgeEntry[];
  all(): readonly KnowledgeEntry[];
}

export interface ChunkRepository {
  findById(id: ChunkId): DocumentChunk | undefined;
  findMany(ids: readonly ChunkId[]): DocumentChunk[];
  /** Every slice of one entry, in order — for re-joining a split passage. */
  byKnowledgeId(id: KnowledgeId): DocumentChunk[];
  all(): readonly DocumentChunk[];
}

export interface SymbolRepository {
  /**
   * The one symbol a query names outright.
   *
   * Accepts everything a reader might type for the same thing:
   * `JIT.string().uuid()`, `jit.string.uuid`, `.uuid()`, `uuid`. Normalization
   * is the repository's job precisely because every caller would get it
   * slightly differently.
   */
  findExact(input: string): ApiSymbol | undefined;

  findById(id: SymbolId): ApiSymbol | undefined;

  /**
   * The symbol at exactly this path, with no fallback.
   *
   * `findExact` walks a chain of candidates on purpose: `JIT.compare.deepEqual`
   * resolving to `JIT.compare` is the right behaviour for retrieval, because
   * the compare page is where the reader needs to go. It is the wrong
   * behaviour for the audit, which asked whether the name the model wrote
   * exists — and got "yes" for a name that does not.
   */
  findByPath(path: string): ApiSymbol | undefined;

  /** Prefix and near-miss matches — `safepars` finds `safeParse`. Never invents. */
  search(input: string, limit?: number): SymbolMatch[];

  /** Siblings, children and the parent — the surface around a name. */
  related(id: SymbolId): ApiSymbol[];

  /** Chain methods valid on one schema kind, for the prompt to show. */
  chainFor(kind: string): ApiSymbol[];

  /**
   * Only the constraints — `.min()`, `.uuid()` — never `.parse()` or `.pipe()`.
   *
   * Structured generation offers a model a menu to pick from (§43), and a menu
   * that includes `.safeParse` invites a validator that is not one. The
   * distinction is the library's own, carried on `ApiSymbol.role`.
   */
  checksFor(kind: string): ApiSymbol[];

  all(): readonly ApiSymbol[];
}

export interface VectorRepository {
  search(vector: Float32Array, limit: number): VectorMatch[];
  readonly dimensions: number;
  /** False when the build shipped without embeddings, or they failed to load. */
  readonly available: boolean;
}

export interface LexicalRepository {
  search(query: string, limit: number): LexicalMatch[];
}

export interface RouteRepository {
  /** The public path, or undefined when the id is not registered. */
  resolve(routeId: RouteId, locale: Locale): string | undefined;
  find(routeId: RouteId): RouteEntry | undefined;
  /** Reverse lookup, for turning the page the reader is on into a signal. */
  fromPath(path: string): RouteEntry | undefined;
  all(): readonly RouteEntry[];
}

/** The loaded artifact set, handed to the repositories that read it. */
export interface KnowledgeSource {
  manifest: KnowledgeManifest;
  entries: KnowledgeEntry[];
  chunks: DocumentChunk[];
  symbols: ApiSymbol[];
  routes: RouteEntry[];
}
