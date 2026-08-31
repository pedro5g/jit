/**
 * Assembly.
 *
 * The one place that knows which concrete class satisfies which contract.
 * Everything above it takes the interfaces; everything below it is a detail.
 * Keeping the wiring in a single function is what makes "run the whole
 * retrieval stack from a test" a two-line operation rather than a mock.
 */
import { HybridRetriever } from "../application/retrieval/hybrid-retriever";
import type { KnowledgeManifest } from "../core/entities/manifest";
import type { ArtifactLoaderPort } from "../core/ports/artifact-loader";
import type {
  ChunkRepository,
  KnowledgeRepository,
  RouteRepository,
  SymbolRepository,
  VectorRepository,
} from "../core/repositories";
import {
  StaticChunkRepository,
  StaticKnowledgeRepository,
  StaticRouteRepository,
  StaticSymbolRepository,
} from "./repositories/static-repositories";
import { type LexicalIndexDocument, StaticLexicalRepository } from "./retrieval/lexical-repository";
import { PackedVectorRepository } from "./retrieval/vector-repository";

export interface KnowledgeEngine {
  manifest: KnowledgeManifest;
  knowledge: KnowledgeRepository;
  chunks: ChunkRepository;
  symbols: SymbolRepository;
  routes: RouteRepository;
  lexical: StaticLexicalRepository;
  vectors: VectorRepository;
  retriever: HybridRetriever;
  /** Whether semantic retrieval is live, for the capability banner (§78). */
  hasSemanticSearch: boolean;
}

/** A loader that can also produce the lexical index, which is not domain data. */
export interface LexicalCapableLoader extends ArtifactLoaderPort {
  loadLexical(): Promise<LexicalIndexDocument>;
}

export async function createKnowledgeEngine(loader: LexicalCapableLoader): Promise<KnowledgeEngine> {
  const manifest = await loader.loadManifest();

  const [source, lexicalIndex, packedVectors] = await Promise.all([
    loader.loadSource(manifest),
    loader.loadLexical(),
    loader.loadVectors(manifest),
  ]);

  const chunks = new StaticChunkRepository(source.chunks);
  const symbols = new StaticSymbolRepository(source.symbols);
  const lexical = new StaticLexicalRepository(lexicalIndex);
  const vectors = new PackedVectorRepository(
    packedVectors,
    source.chunks.map((chunk) => chunk.id),
    manifest.embedding.dimensions
  );

  return {
    manifest,
    knowledge: new StaticKnowledgeRepository(source.entries),
    chunks,
    symbols,
    routes: new StaticRouteRepository(source.routes),
    lexical,
    vectors,
    retriever: new HybridRetriever({ chunks, symbols, lexical, vectors }),
    hasSemanticSearch: vectors.available,
  };
}
