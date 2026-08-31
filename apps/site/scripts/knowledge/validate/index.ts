/**
 * What has to be true before artifacts are allowed to ship.
 *
 * §67 lists the failures that must break CI, and every one of them shares a
 * shape: it is invisible at build time and produces a confidently wrong answer
 * at read time. A route id that resolves to nothing does not throw — it
 * produces a navigation action the reader clicks and lands on a 404. A
 * duplicated chunk id does not throw either; it silently makes one of the two
 * chunks unreachable, and which one depends on map insertion order.
 *
 * So they are checked here, once, where the fix is cheap.
 */
import type { ApiSymbol } from "../../../lib/copilot/core/entities/api-symbol";
import type { DocumentChunk } from "../../../lib/copilot/core/entities/document-chunk";
import type { KnowledgeEntry } from "../../../lib/copilot/core/entities/knowledge-entry";
import type { KnowledgeManifest } from "../../../lib/copilot/core/entities/manifest";
import type { RouteEntry } from "../../../lib/copilot/core/entities/route-entry";
import { isChunkId, isKnowledgeId, isRouteId, isSymbolId } from "../../../lib/copilot/core/value-objects/ids";
import { LOCALES } from "../../../lib/copilot/core/value-objects/locale";

export interface ValidationProblem {
  kind: "id" | "route" | "symbol" | "relation" | "locale" | "manifest" | "coverage" | "low-confidence-route";
  detail: string;
}

export interface ValidationInput {
  manifest: KnowledgeManifest;
  entries: KnowledgeEntry[];
  chunks: DocumentChunk[];
  symbols: ApiSymbol[];
  routes: RouteEntry[];
}

export function validateArtifacts(input: ValidationInput): ValidationProblem[] {
  const problems: ValidationProblem[] = [];
  const report = (kind: ValidationProblem["kind"], detail: string) => problems.push({ kind, detail });

  const routeIds = new Set(input.routes.map((route) => route.id));
  const symbolIds = new Set(input.symbols.map((symbol) => symbol.id));
  const entryIds = new Set(input.entries.map((entry) => entry.id));
  const locales = new Set<string>(LOCALES);

  // ------------------------------------------------------------------- ids
  const seenEntry = new Set<string>();
  for (const entry of input.entries) {
    if (!isKnowledgeId(entry.id)) report("id", `${entry.id} is not a well-formed knowledge id`);
    if (seenEntry.has(entry.id)) report("id", `duplicate knowledge id ${entry.id} (${entry.source.file})`);
    seenEntry.add(entry.id);

    if (!locales.has(entry.locale)) report("locale", `${entry.id} declares an unknown locale ${entry.locale}`);
    if (!routeIds.has(entry.routeId)) report("route", `${entry.id} points at unregistered route ${entry.routeId}`);

    for (const symbol of entry.symbols) {
      if (!isSymbolId(symbol)) report("id", `${entry.id} carries a malformed symbol id ${symbol}`);
      else if (!symbolIds.has(symbol)) report("symbol", `${entry.id} references unknown symbol ${symbol}`);
    }

    for (const related of entry.related) {
      if (!entryIds.has(related)) report("relation", `${entry.id} relates to unknown entry ${related}`);
      if (related === entry.id) report("relation", `${entry.id} relates to itself`);
    }
  }

  const seenChunk = new Set<string>();
  for (const chunk of input.chunks) {
    if (!isChunkId(chunk.id)) report("id", `${chunk.id} is not a well-formed chunk id`);
    if (seenChunk.has(chunk.id)) report("id", `duplicate chunk id ${chunk.id}`);
    seenChunk.add(chunk.id);

    if (!entryIds.has(chunk.knowledgeId))
      report("relation", `${chunk.id} belongs to unknown entry ${chunk.knowledgeId}`);
    if (!routeIds.has(chunk.routeId)) report("route", `${chunk.id} points at unregistered route ${chunk.routeId}`);
    if (!chunk.content.trim()) report("coverage", `${chunk.id} is empty`);
  }

  // ---------------------------------------------------------------- routes
  const seenRoute = new Set<string>();
  const seenPath = new Set<string>();
  for (const route of input.routes) {
    if (!isRouteId(route.id)) report("id", `${route.id} is not a well-formed route id`);
    if (seenRoute.has(route.id)) report("id", `duplicate route id ${route.id}`);
    if (seenPath.has(route.path)) report("route", `two routes claim the path ${route.path}`);
    seenRoute.add(route.id);
    seenPath.add(route.path);

    if (route.locales.length === 0) report("locale", `${route.id} exists in no locale`);
  }

  // --------------------------------------------------------------- symbols
  const seenSymbol = new Set<string>();
  for (const symbol of input.symbols) {
    if (!isSymbolId(symbol.id)) report("id", `${symbol.id} is not a well-formed symbol id`);
    if (seenSymbol.has(symbol.id)) report("id", `duplicate symbol id ${symbol.id}`);
    seenSymbol.add(symbol.id);

    if (symbol.parent && !symbolIds.has(symbol.parent)) {
      report("symbol", `${symbol.id} claims unknown parent ${symbol.parent}`);
    }
    if (symbol.routeId && !routeIds.has(symbol.routeId)) {
      report("route", `${symbol.id} is documented at unregistered route ${symbol.routeId}`);
    }
    for (const example of symbol.examples) {
      if (!entryIds.has(example)) report("relation", `${symbol.id} cites unknown entry ${example}`);
    }
  }

  /**
   * A top-level export nothing documents.
   *
   * Reported rather than fatal: the ghost can still say a name exists and
   * refuse to explain it, which is far better than claiming it does not exist.
   * But it is the single most useful signal about where the documentation has
   * a hole, and it is free to compute here.
   */
  const documented = new Set(input.entries.flatMap((entry) => entry.symbols));
  const undocumented = input.symbols
    .filter((symbol) => !symbol.parent && symbol.kind !== "type" && !documented.has(symbol.id))
    .map((symbol) => symbol.path);

  if (undocumented.length > 0) {
    report(
      "coverage",
      `${undocumented.length} public member(s) appear in no documentation: ${undocumented.join(", ")}`
    );
  }

  /**
   * A symbol whose declared page never mentions it.
   *
   * The reference index table is a statement by an author about which page
   * owns a name, and it is trusted over any inference — so when the page it
   * names contains no passage using the API, the ghost cites a page that does
   * not answer the question. `JIT.from` is documented as living on the query
   * reference and is only ever demonstrated on the DTO pages.
   *
   * Advisory rather than fatal: the row may be aspirational, and citing a
   * related page beats citing nothing. But it is a documentation bug, and the
   * cheapest place to find one is here.
   */
  const entriesById = new Map(input.entries.map((entry) => [entry.id, entry]));
  const misdeclared = input.symbols
    .filter((symbol) => symbol.routeId && symbol.examples.length > 0)
    .filter((symbol) => !symbol.examples.some((id) => entriesById.get(id)?.routeId === symbol.routeId))
    .map((symbol) => `${symbol.path} -> ${symbol.routeId}`);

  if (misdeclared.length > 0) {
    report(
      "coverage",
      `${misdeclared.length} member(s) are documented at a page that never uses them: ${misdeclared.join(", ")}`
    );
  }

  // -------------------------------------------------------------- manifest
  const { counts } = input.manifest;
  if (counts.entries !== input.entries.length) report("manifest", "manifest entry count disagrees with knowledge.json");
  if (counts.chunks !== input.chunks.length) report("manifest", "manifest chunk count disagrees with chunks.json");
  if (counts.symbols !== input.symbols.length) report("manifest", "manifest symbol count disagrees with symbols.json");
  if (counts.routes !== input.routes.length) report("manifest", "manifest route count disagrees with routes.json");
  if (!input.manifest.contentHash) report("manifest", "manifest carries no content hash");
  if (input.entries.length === 0) report("coverage", "no knowledge entries were produced");

  return problems;
}

/** Problems that must fail a build, as opposed to ones worth printing. */
export function isFatal(problem: ValidationProblem): boolean {
  return problem.kind !== "coverage" && problem.kind !== "low-confidence-route";
}
