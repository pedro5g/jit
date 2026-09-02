/**
 * The repositories, backed by the compiled artifacts.
 *
 * Everything here is built once from arrays that were sorted at compile time,
 * and everything here is synchronous. That combination is what lets the same
 * objects serve a browser, a build script and a vitest run: there is no
 * fetching, no lazy loading and no cache to warm — the loading happened before
 * any of this was constructed.
 */

import { normalizeSymbolInput, symbolCandidates } from "../../application/retrieval/symbol-query";
import { resolvePath } from "../../config/routes";
import type { ApiSymbol } from "../../core/entities/api-symbol";
import type { DocumentChunk } from "../../core/entities/document-chunk";
import type { KnowledgeEntry } from "../../core/entities/knowledge-entry";
import type { KnowledgeRelation } from "../../core/entities/knowledge-relation";
import type { SymbolMatch } from "../../core/entities/retrieval";
import type { RouteEntry } from "../../core/entities/route-entry";
import type {
  ChunkRepository,
  KnowledgeGraphRepository,
  KnowledgeRepository,
  RouteRepository,
  SymbolRepository,
} from "../../core/repositories";
import type { ChunkId, KnowledgeId, RouteId, SymbolId } from "../../core/value-objects/ids";
import { symbolPath } from "../../core/value-objects/ids";
import type { Locale } from "../../core/value-objects/locale";

export class StaticKnowledgeRepository implements KnowledgeRepository {
  private readonly byId: Map<string, KnowledgeEntry>;
  private readonly bySymbolId = new Map<string, KnowledgeEntry[]>();

  constructor(private readonly entries: KnowledgeEntry[]) {
    this.byId = new Map(entries.map((entry) => [entry.id, entry]));

    for (const entry of entries) {
      for (const symbol of entry.symbols) {
        const list = this.bySymbolId.get(symbol);
        if (list) list.push(entry);
        else this.bySymbolId.set(symbol, [entry]);
      }
    }
  }

  findById(id: KnowledgeId): KnowledgeEntry | undefined {
    return this.byId.get(id);
  }

  findMany(ids: readonly KnowledgeId[]): KnowledgeEntry[] {
    const found: KnowledgeEntry[] = [];
    for (const id of ids) {
      const entry = this.byId.get(id);
      if (entry) found.push(entry);
    }
    return found;
  }

  bySymbol(id: SymbolId): KnowledgeEntry[] {
    // A reference page is *about* the symbol; a guide merely uses it. Both are
    // real answers to "what is this", in that order.
    return (this.bySymbolId.get(id) ?? [])
      .slice()
      .sort((left, right) => rank(left) - rank(right) || left.id.localeCompare(right.id));
  }

  all(): readonly KnowledgeEntry[] {
    return this.entries;
  }
}

export class StaticKnowledgeGraphRepository implements KnowledgeGraphRepository {
  private readonly bySource = new Map<string, KnowledgeRelation[]>();

  constructor(private readonly relations: KnowledgeRelation[]) {
    for (const relation of relations) {
      const list = this.bySource.get(relation.from) ?? [];
      list.push(relation);
      this.bySource.set(relation.from, list);
    }
  }

  neighbours(id: KnowledgeId): readonly KnowledgeRelation[] {
    return this.bySource.get(id) ?? [];
  }

  all(): readonly KnowledgeRelation[] {
    return this.relations;
  }
}

const KIND_RANK: Record<string, number> = { reference: 0, api: 1, concept: 2, guide: 3, example: 4 };

/**
 * Which symbol a bare name means.
 *
 * Almost every interesting name is ambiguous once all three levels are
 * indexed. `safeParse` is a member of `JIT.validate` *and* a chain method on
 * all nine schema kinds — ten symbols. `uuid` is `JIT.regexes.uuid` and
 * `JIT.string().uuid()`. Refusing to answer when a name is ambiguous, which is
 * what this used to do, means exact lookup never fires for the two names
 * readers ask about most.
 *
 * So it resolves, by evidence first: the symbol the documentation actually
 * spends its pages on is the one a reader asking a bare question means.
 * `JIT.string().uuid()` has seven passages behind it and `JIT.regexes.uuid`
 * has one, and that difference is the answer. Kind breaks a tie — a namespace
 * function is the canonical spelling of an operation that a chain method
 * reaches a second way — and the id breaks it after that, so the order is
 * total and the build is reproducible.
 */
const SYMBOL_KIND_RANK: Record<string, number> = {
  namespace: 0,
  factory: 1,
  function: 2,
  method: 3,
  operator: 4,
  type: 5,
};

function byEvidence(left: ApiSymbol, right: ApiSymbol): number {
  return (
    right.examples.length - left.examples.length ||
    (SYMBOL_KIND_RANK[left.kind] ?? 9) - (SYMBOL_KIND_RANK[right.kind] ?? 9) ||
    left.id.localeCompare(right.id)
  );
}

function rank(entry: KnowledgeEntry): number {
  return KIND_RANK[entry.kind] ?? 9;
}

export class StaticChunkRepository implements ChunkRepository {
  private readonly byId: Map<string, DocumentChunk>;
  private readonly byEntry = new Map<string, DocumentChunk[]>();

  constructor(private readonly chunks: DocumentChunk[]) {
    this.byId = new Map(chunks.map((chunk) => [chunk.id, chunk]));

    for (const chunk of chunks) {
      const list = this.byEntry.get(chunk.knowledgeId);
      if (list) list.push(chunk);
      else this.byEntry.set(chunk.knowledgeId, [chunk]);
    }

    for (const list of this.byEntry.values()) list.sort((left, right) => left.part - right.part);
  }

  findById(id: ChunkId): DocumentChunk | undefined {
    return this.byId.get(id);
  }

  findMany(ids: readonly ChunkId[]): DocumentChunk[] {
    const found: DocumentChunk[] = [];
    for (const id of ids) {
      const chunk = this.byId.get(id);
      if (chunk) found.push(chunk);
    }
    return found;
  }

  byKnowledgeId(id: KnowledgeId): DocumentChunk[] {
    return this.byEntry.get(id) ?? [];
  }

  all(): readonly DocumentChunk[] {
    return this.chunks;
  }
}

/**
 * Exact and near-miss symbol lookup.
 *
 * Three maps, because three questions get asked and each would be a scan
 * otherwise: by id, by lowercased path, and by lowercased bare name. The last
 * one holds a list, ordered by `byEvidence` — a bare name is usually ambiguous
 * across the three levels, and which of them a reader means is decided once,
 * here, rather than by every caller.
 */
export class StaticSymbolRepository implements SymbolRepository {
  private readonly byId: Map<string, ApiSymbol>;
  private readonly byPath = new Map<string, ApiSymbol>();
  private readonly byName = new Map<string, ApiSymbol[]>();
  private readonly children = new Map<string, ApiSymbol[]>();

  constructor(private readonly symbols: ApiSymbol[]) {
    this.byId = new Map(symbols.map((symbol) => [symbol.id, symbol]));

    for (const symbol of symbols) {
      /**
       * Case-folded paths collide, and the collision matters.
       *
       * `JIT.Update` is a type export and `JIT.state.update` is the function
       * readers ask about; both fold to `jit.update`. Whichever was written
       * last used to win, which put a type with no documentation in front of
       * the API that has eight passages behind it.
       */
      const key = symbolPath(symbol.id).toLowerCase();
      const existing = this.byPath.get(key);
      if (!existing || byEvidence(symbol, existing) < 0) this.byPath.set(key, symbol);

      const name = symbol.name.toLowerCase();
      const named = this.byName.get(name);
      if (named) named.push(symbol);
      else this.byName.set(name, [symbol]);

      if (symbol.parent) {
        const siblings = this.children.get(symbol.parent);
        if (siblings) siblings.push(symbol);
        else this.children.set(symbol.parent, [symbol]);
      }
    }

    for (const named of this.byName.values()) named.sort(byEvidence);
  }

  findById(id: SymbolId): ApiSymbol | undefined {
    return this.byId.get(id);
  }

  findByPath(path: string): ApiSymbol | undefined {
    const normalized = normalizeSymbolInput(path).toLowerCase();
    return this.byPath.get(normalized.startsWith("jit.") ? normalized : `jit.${normalized}`);
  }

  findExact(input: string): ApiSymbol | undefined {
    const candidates = symbolCandidates(input);

    /**
     * A written path is a statement; a bare word is a guess.
     *
     * `JIT.validate.safeParse` names one thing and the reader said which, so
     * the first path hit wins outright. A lone `update` is different: it looks
     * like the path `jit.update`, which is the undocumented type export
     * `JIT.Update`, *and* like the name of `JIT.state.update`, which is the
     * function every question about it means. Taking the path hit because it
     * was checked first put a type with no documentation behind it in front of
     * an API with eight passages.
     */
    const explicit = normalizeSymbolInput(input).includes(".");

    let best: ApiSymbol | undefined;

    for (const candidate of candidates) {
      if (candidate.path) {
        const found = this.byPath.get(candidate.path.toLowerCase());
        if (found) {
          if (explicit) return found;
          if (!best || byEvidence(found, best) < 0) best = found;
        }
      }

      if (candidate.name) {
        const named = this.byName.get(candidate.name.toLowerCase());
        // already ordered by evidence in the constructor
        const found = named?.[0];
        if (found && (!best || byEvidence(found, best) < 0)) best = found;
      }
    }

    return best;
  }

  search(input: string, limit = 8): SymbolMatch[] {
    const exact = this.findExact(input);
    if (exact) return [{ symbol: exact, kind: "exact", score: 1 }];

    const needle = input
      .toLowerCase()
      .replace(/[^a-z0-9.]/g, "")
      .replace(/^jit\./, "");
    if (needle.length < 2) return [];

    const matches: SymbolMatch[] = [];

    for (const symbol of this.symbols) {
      const name = symbol.name.toLowerCase();
      const path = symbolPath(symbol.id).toLowerCase();

      // Prefix before substring, and a shorter name before a longer one:
      // `safepars` should reach `safeParse`, not `unsafeParseAndCoerce`.
      if (name.startsWith(needle) || path.startsWith(`jit.${needle}`)) {
        matches.push({ symbol, kind: "prefix", score: needle.length / name.length });
      } else if (name.includes(needle)) {
        matches.push({ symbol, kind: "fuzzy", score: (0.6 * needle.length) / name.length });
      }
    }

    // Same name, same prefix score: `safeParse` is a namespace function and a
    // chain method on nine kinds. Evidence decides, not the alphabet.
    return matches
      .sort((left, right) => right.score - left.score || byEvidence(left.symbol, right.symbol))
      .slice(0, limit);
  }

  related(id: SymbolId): ApiSymbol[] {
    const symbol = this.byId.get(id);
    if (!symbol) return [];

    const siblings = symbol.parent ? (this.children.get(symbol.parent) ?? []) : [];
    const parent = symbol.parent ? this.byId.get(symbol.parent) : undefined;

    return [
      ...(parent ? [parent] : []),
      ...(this.children.get(symbol.id) ?? []),
      ...siblings.filter((entry) => entry.id !== id),
    ];
  }

  chainFor(kind: string): ApiSymbol[] {
    const prefix = `jit.${kind}.`;
    return this.symbols.filter(
      (symbol) => (symbol.kind === "method" || symbol.kind === "operator") && symbolPath(symbol.id).startsWith(prefix)
    );
  }

  checksFor(kind: string): ApiSymbol[] {
    return this.chainFor(kind).filter((symbol) => symbol.role === "check");
  }

  all(): readonly ApiSymbol[] {
    return this.symbols;
  }
}

export class StaticRouteRepository implements RouteRepository {
  private readonly byId: Map<string, RouteEntry>;
  private readonly byPath: Map<string, RouteEntry>;

  constructor(private readonly routes: RouteEntry[]) {
    this.byId = new Map(routes.map((route) => [route.id, route]));
    this.byPath = new Map(routes.map((route) => [route.path, route]));
  }

  resolve(routeId: RouteId, locale: Locale): string | undefined {
    const route = this.byId.get(routeId);
    if (!route) return undefined;

    // A page that does not exist in the reader's language is still the right
    // page — §65: the source stays English and the answer is translated.
    return resolvePath(route.path, route.locales.includes(locale) ? locale : route.locales[0]);
  }

  find(routeId: RouteId): RouteEntry | undefined {
    return this.byId.get(routeId);
  }

  fromPath(path: string): RouteEntry | undefined {
    return this.byPath.get(
      path
        .split("#")[0]
        .split("?")[0]
        .replace(/(.)\/+$/, "$1")
    );
  }

  all(): readonly RouteEntry[] {
    return this.routes;
  }
}
