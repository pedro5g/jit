/**
 * The knowledge compiler.
 *
 *   pnpm knowledge:build       compile everything, reusing cached embeddings
 *   pnpm knowledge:build --no-embed    skip the model entirely (lexical only)
 *   pnpm knowledge:validate    compile in memory and report, writing nothing
 *   pnpm knowledge:inspect "…" run a query against the artifacts and explain it
 *   pnpm knowledge:clean       drop artifacts and the embedding cache
 *
 * The pipeline is §16's, in order: discover, parse, normalize, extract
 * symbols, build entries, chunk, link, hash, reuse, embed, index, validate,
 * write. Each stage is a module; this file is only the sequence, which is
 * deliberate — the stages are individually testable and the order is the thing
 * that has to be readable.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { ARTIFACT_DIR, ARTIFACT_VERSION, EMBEDDING_CACHE_DIR } from "../../lib/copilot/config/artifacts";
import { EMBEDDING_MODEL } from "../../lib/copilot/config/models";
import { DOCS_CONTENT_DIR, docRoute } from "../../lib/copilot/config/routes";
import type { ApiSymbol } from "../../lib/copilot/core/entities/api-symbol";
import type { DocumentChunk } from "../../lib/copilot/core/entities/document-chunk";
import type { KnowledgeEntry, KnowledgeKind } from "../../lib/copilot/core/entities/knowledge-entry";
import type { KnowledgeRelation } from "../../lib/copilot/core/entities/knowledge-relation";
import type { KnowledgeManifest } from "../../lib/copilot/core/entities/manifest";
import { chunkId, type KnowledgeId, knowledgeId } from "../../lib/copilot/core/value-objects/ids";
import { DEFAULT_LOCALE, LOCALES } from "../../lib/copilot/core/value-objects/locale";
import { discoverDocs, type SourceFile } from "./discover";
import { EmbeddingCache } from "./embeddings/cache";
import { embeddingText, TransformersEmbedder } from "./embeddings/embed";
import { buildLexicalIndex } from "./indexes/lexical";
import { extractApi } from "./parsers/api";
import { type ParsedSection, parseDocument } from "./parsers/docs";
import { isRunnableExample, runExample } from "./parsers/examples";
import { extractRoutes } from "./parsers/routes";
import { chunkSection } from "./transform/chunk";
import { deriveFacets } from "./transform/facets";
import { digest, embeddingHash, normalizeForHash, sha256 } from "./transform/normalize";
import { linkRelationships } from "./transform/relationships";
import { createSymbolLinker, quotesRemovedApis } from "./transform/symbols";
import { isFatal, validateArtifacts } from "./validate";
import { writeArtifacts } from "./write";

const siteDir = path.resolve(import.meta.dirname, "../..");
const contentDir = path.join(siteDir, DOCS_CONTENT_DIR);
const packageSrc = path.resolve(siteDir, "../../packages/jit/src");
const outDir = path.join(siteDir, "public", ARTIFACT_DIR);
const cacheDir = path.join(siteDir, EMBEDDING_CACHE_DIR);

/**
 * Pages whose subject is what changed, not what the library does.
 *
 * Kept as a rule about paths rather than a per-page flag, because it has to be
 * decidable before the page is read — a page is history because of where it
 * lives, and a new migration guide should inherit the treatment without anyone
 * remembering to mark it.
 */
const HISTORY_PAGES = [/^whats-new/, /^guides\/migrating-to/];

function kindFor(relative: string, section: ParsedSection): KnowledgeKind {
  if (HISTORY_PAGES.some((pattern) => pattern.test(relative))) return "migration";
  if (relative.startsWith("reference/")) return "reference";
  if (relative.startsWith("concepts/")) return "concept";
  if (relative.startsWith("guides/")) return "guide";
  if (relative.startsWith("aot/") || relative.startsWith("runtime/")) return "reference";
  // an intro section on a page with no headings above it is the overview
  return section.depth === 0 ? "overview" : "guide";
}

export interface BuildOptions {
  embed: boolean;
  verifyExamples: boolean;
  write: boolean;
  quiet: boolean;
}

export interface BuildResult {
  manifest: KnowledgeManifest;
  entries: KnowledgeEntry[];
  relations: KnowledgeRelation[];
  chunks: DocumentChunk[];
  symbols: ApiSymbol[];
  routes: Awaited<ReturnType<typeof extractRoutes>>["routes"];
  /** The posting list, so a caller can build an engine without writing to disk. */
  lexical: ReturnType<typeof buildLexicalIndex>;
  vectors: Float32Array[] | null;
  problems: ReturnType<typeof validateArtifacts>;
  apiProblems: string[];
  exampleFailures: { file: string; detail: string }[];
  cache: { hits: number; misses: number };
}

export async function build(options: BuildOptions): Promise<BuildResult> {
  const log = (message: string) => {
    if (!options.quiet) console.log(message);
  };

  // ------------------------------------------------------------- discover
  const files = await discoverDocs(contentDir);
  const sources = new Map<string, string>();
  const read = async (file: SourceFile) => {
    const cached = sources.get(file.relative);
    if (cached !== undefined) return cached;

    const source = await fs.readFile(file.absolute, "utf8");
    sources.set(file.relative, source);
    return source;
  };

  log(`[knowledge] ${files.length} pages under ${DOCS_CONTENT_DIR}`);

  // ------------------------------------------------- parse: api and routes
  const api = await extractApi(packageSrc, path.join(contentDir, "reference/functions/index.mdx"));
  const { routes, byPath } = await extractRoutes(files, read);
  const linkSymbols = createSymbolLinker({ symbols: api.symbols, chain: api.chain });

  // --------------------------------------------- parse: docs into entries
  const entries: KnowledgeEntry[] = [];
  const declared = new Map<KnowledgeId, string[]>();
  const references = new Map<KnowledgeId, string[]>();
  /** How strongly each entry names each symbol, for evidence-ranked assignment. */
  const linkWeights = new Map<KnowledgeId, Map<string, number>>();
  const entriesByPath = new Map<string, KnowledgeEntry[]>();
  const exampleFailures: { file: string; detail: string }[] = [];
  let examplesRun = 0;

  for (const file of files) {
    const document = parseDocument(file.relative, await read(file));
    const route = docRoute(file.relative);
    const related = (document.frontmatter.related ?? "")
      .split(",")
      .map((entry) => entry.trim())
      .filter((entry) => entry.startsWith("/"));

    /** Headings repeat within a page — `part` is what keeps their ids apart. */
    const usedIds = new Map<string, number>();

    for (const section of document.sections) {
      const base = [...route.slug, section.anchor ?? "index"].join("-");
      const seen = usedIds.get(base) ?? 0;
      usedIds.set(base, seen + 1);

      const id = knowledgeId("docs", ...route.slug, section.anchor ?? "index", ...(seen > 0 ? [String(seen)] : []));

      if (options.verifyExamples) {
        for (const block of section.code) {
          if (!isRunnableExample(block.lang, block.source)) continue;

          examplesRun += 1;
          const failure = await runExample(block.source);
          if (failure) exampleFailures.push({ file: file.relative, detail: failure });
        }
      }

      const links = linkSymbols(section.text, `${document.title} ${section.heading}`);
      linkWeights.set(id, new Map(links.map((link) => [link.id, link.weight])));

      const kind = kindFor(file.relative, section);
      const entry: KnowledgeEntry = {
        id,
        kind,
        locale: DEFAULT_LOCALE,
        title: section.heading,
        breadcrumb: section.breadcrumb || document.title,
        content: section.text,
        routeId: route.id,
        ...(section.anchor ? { anchor: section.anchor } : {}),
        symbols: links.map((link) => link.id),
        facets: deriveFacets({
          title: section.heading,
          breadcrumb: section.breadcrumb || document.title,
          routeId: route.id,
          symbols: links.map((link) => link.id),
          kind,
          concepts: section.concepts,
        }),
        related: [],
        dense: section.dense,
        showsRemovedApis: quotesRemovedApis(section.text, api.symbols),
        source: {
          file: path.posix.join(DOCS_CONTENT_DIR, file.relative),
          hash: digest(normalizeForHash(section.text)),
        },
      };

      entries.push(entry);
      declared.set(id, related);
      references.set(id, section.references);

      const onPath = entriesByPath.get(route.path) ?? [];
      onPath.push(entry);
      entriesByPath.set(route.path, onPath);
    }
  }

  log(`[knowledge] ${entries.length} entries`);
  if (options.verifyExamples) {
    log(`[knowledge] ${examplesRun} examples executed, ${exampleFailures.length} failing`);
  }

  // -------------------------------------------------------- relationships
  const relations = linkRelationships({ entries, entriesByPath, declared, references });
  log(`[knowledge] ${relations.length} relations`);

  /**
   * Where each symbol is documented, and by what.
   *
   * The reverse of the entry -> symbol edge, and the thing that makes
   * "what is JIT.validate.safeParse?" a lookup rather than a search. A
   * reference page outranks a guide that merely uses the API, because the
   * reference page is *about* it.
   */
  const symbolsById = new Map(api.symbols.map((symbol) => [symbol.id, symbol]));
  /** Candidate entries per symbol, with the evidence that put them there. */
  const evidence = new Map<string, { entry: KnowledgeEntry; weight: number }[]>();

  for (const entry of entries) {
    const weights = linkWeights.get(entry.id);
    for (const id of entry.symbols) {
      if (!symbolsById.has(id)) continue;

      const list = evidence.get(id) ?? [];
      list.push({ entry, weight: weights?.get(id) ?? 1 });
      evidence.set(id, list);
    }
  }

  /** A page that explains the API outranks one that merely calls it. */
  const KIND_RANK: Record<string, number> = { reference: 0, concept: 1, overview: 2, guide: 3, migration: 9 };

  const byEvidence = (
    left: { entry: KnowledgeEntry; weight: number },
    right: { entry: KnowledgeEntry; weight: number }
  ) =>
    right.weight - left.weight ||
    (KIND_RANK[left.entry.kind] ?? 5) - (KIND_RANK[right.entry.kind] ?? 5) ||
    left.entry.id.localeCompare(right.entry.id);

  for (const symbol of api.symbols) {
    const candidates = (evidence.get(symbol.id) ?? []).sort(byEvidence);

    /**
     * Where the symbol is documented.
     *
     * The reference index table is authoritative for a top-level member: it is
     * a statement by an author about which page owns the name, and it beats
     * any amount of inference. Everything below that level — a chain method, a
     * namespace function — has no table row, so the best evidence wins: the
     * highest-weighted reference entry, which is one whose heading or a
     * declaration line names it.
     */
    const documentedAt = symbol.parent ? undefined : api.documentedUrls.get(symbol.name);
    const declaredRoute = documentedAt ? byPath.get(documentedAt)?.id : undefined;

    /**
     * The route, and how strongly the evidence supports it.
     *
     * Four tiers, in the order §PART 7 states: a declared table row, a heading
     * that names the symbol, a declaration line that defines it, and — last
     * and weakest — a page that merely mentions it. The last tier is still
     * used, because a related page beats no page for retrieval, but it is
     * labelled so that anything stricter than retrieval can refuse it.
     */
    const heading = candidates.find(({ entry, weight }) => weight >= 3 && entry.kind === "reference");
    const declaration = candidates.find(({ entry, weight }) => weight >= 2 && entry.kind === "reference");
    const reference = candidates.find(({ entry }) => entry.kind === "reference");

    if (declaredRoute) {
      symbol.routeId = declaredRoute;
      symbol.routeConfidence = "declared";
    } else if (heading) {
      symbol.routeId = heading.entry.routeId;
      symbol.routeConfidence = "heading";
    } else if (declaration) {
      symbol.routeId = declaration.entry.routeId;
      symbol.routeConfidence = "declaration";
    } else if (reference ?? candidates[0]) {
      symbol.routeId = (reference ?? candidates[0]).entry.routeId;
      symbol.routeConfidence = "mention";
    }

    /**
     * The symbol's own page first, then everywhere else.
     *
     * `examples` is truncated, and until this sorted by weight alone the
     * truncation was decided alphabetically among the ties — so `JIT.cqrs`
     * kept eight passages that merely mention it (`aot/cli-and-config`,
     * `reference/functions/access`, …) and dropped every passage on
     * `reference/functions/query`, the page that documents it. Retrieval then
     * had nothing authoritative to return for a question that named the API
     * outright, which is the one case it must never get wrong.
     */
    const owned = symbol.routeId;
    symbol.examples = candidates
      .sort(
        (left, right) =>
          Number(right.entry.routeId === owned) - Number(left.entry.routeId === owned) || byEvidence(left, right)
      )
      .slice(0, 8)
      .map(({ entry }) => entry.id);
  }

  // ----------------------------------------------------------------- chunk
  const chunks: DocumentChunk[] = [];

  for (const entry of entries) {
    const pieces = chunkSection(entry.content);

    for (const [part, content] of pieces.entries()) {
      chunks.push({
        id: chunkId(entry.id.replace(/^knowledge\./, ""), String(part)),
        knowledgeId: entry.id,
        locale: entry.locale,
        title: entry.title,
        breadcrumb: entry.breadcrumb,
        content,
        routeId: entry.routeId,
        ...(entry.anchor ? { anchor: entry.anchor } : {}),
        kind: entry.kind,
        dense: entry.dense,
        showsRemovedApis: entry.showsRemovedApis,
        symbols: entry.symbols,
        part,
        parts: pieces.length,
        sourceFile: entry.source.file,
        sourceHash: entry.source.hash,
        embeddingHash: embeddingHash(
          embeddingText(entry.breadcrumb, entry.title, content),
          EMBEDDING_MODEL.id,
          EMBEDDING_MODEL.pipelineVersion
        ),
      });
    }
  }

  log(`[knowledge] ${chunks.length} chunks (${chunks.filter((chunk) => chunk.parts > 1).length} from split entries)`);

  // ------------------------------------------------------------ embeddings
  let vectors: Float32Array[] | null = null;
  const cache = new EmbeddingCache(cacheDir, EMBEDDING_MODEL.dimensions);

  if (options.embed) {
    await cache.prepare();

    const cached = await Promise.all(chunks.map((chunk) => cache.read(chunk.embeddingHash)));
    const missing = chunks.map((chunk, index) => ({ chunk, index })).filter(({ index }) => !cached[index]);

    log(`[knowledge] ${chunks.length - missing.length} vectors reused, ${missing.length} to compute`);

    if (missing.length > 0) {
      const embedder = new TransformersEmbedder();
      const computed = await embedder.embedAll(
        missing.map(({ chunk }) => embeddingText(chunk.breadcrumb, chunk.title, chunk.content)),
        (done, total) => {
          if (done % 64 === 0 || done === total) log(`[knowledge]   embedded ${done}/${total}`);
        }
      );

      for (const [position, { chunk, index }] of missing.entries()) {
        cached[index] = computed[position];
        await cache.write(chunk.embeddingHash, computed[position]);
      }
    }

    vectors = cached as Float32Array[];
    await cache.prune(new Set(chunks.map((chunk) => chunk.embeddingHash)));
  }

  // --------------------------------------------------------------- indexes
  const lexical = buildLexicalIndex(chunks);

  // -------------------------------------------------------------- manifest
  const manifest: KnowledgeManifest = {
    version: ARTIFACT_VERSION,
    contentHash: sha256(
      ...chunks.map((chunk) => `${chunk.id}@${chunk.sourceHash}`),
      ...relations.map((relation) => `${relation.from}>${relation.kind}>${relation.to}@${relation.source}`)
    ).slice(0, 16),
    builtAt: new Date().toISOString(),
    embedding: {
      model: EMBEDDING_MODEL.repo,
      dimensions: EMBEDDING_MODEL.dimensions,
      dtype: "float32",
      pipelineVersion: EMBEDDING_MODEL.pipelineVersion,
    },
    locales: [...LOCALES],
    counts: {
      documents: files.length,
      entries: entries.length,
      chunks: chunks.length,
      symbols: api.symbols.length,
      routes: routes.length,
      relations: relations.length,
      vectors: vectors?.length ?? 0,
    },
    bytes: {},
  };

  // -------------------------------------------------------------- validate
  const problems = validateArtifacts({ manifest, entries, chunks, symbols: api.symbols, routes, relations });

  // ----------------------------------------------------------------- write
  if (options.write && !problems.some(isFatal)) {
    const bytes = await writeArtifacts({
      outDir,
      manifest,
      entries,
      chunks,
      symbols: api.symbols,
      routes,
      relations,
      lexical,
      vectors,
    });
    manifest.bytes = bytes;

    const total = Object.values(bytes).reduce((sum, size) => sum + size, 0);
    log(`[knowledge] ${(total / 1024).toFixed(0)} KB -> public/${ARTIFACT_DIR}/`);
  }

  return {
    manifest,
    entries,
    relations,
    chunks,
    symbols: api.symbols,
    routes,
    lexical,
    vectors,
    problems,
    apiProblems: api.problems,
    exampleFailures,
    cache: cache.stats,
  };
}

export { cacheDir, outDir, siteDir };
