/**
 * Artifacts held in memory, straight out of a compiler run.
 *
 * Two callers, and both are the reason the loader is a port at all. The test
 * suite compiles the real documentation and queries it without writing a byte
 * — so it neither needs artifacts to exist nor can clobber the ones the dev
 * server is serving. And a future in-browser rebuild would need exactly this
 * shape.
 */
import type { ApiSymbol } from "../../core/entities/api-symbol";
import type { DocumentChunk } from "../../core/entities/document-chunk";
import type { KnowledgeEntry } from "../../core/entities/knowledge-entry";
import type { KnowledgeManifest } from "../../core/entities/manifest";
import type { RouteEntry } from "../../core/entities/route-entry";
import type { KnowledgeSource } from "../../core/repositories";
import type { LexicalCapableLoader } from "../knowledge-engine";
import type { LexicalIndexDocument } from "../retrieval/lexical-repository";

export interface MemoryArtifacts {
  manifest: KnowledgeManifest;
  entries: KnowledgeEntry[];
  chunks: DocumentChunk[];
  symbols: ApiSymbol[];
  routes: RouteEntry[];
  lexical: LexicalIndexDocument;
  vectors?: Float32Array[] | null;
}

export class MemoryArtifactLoader implements LexicalCapableLoader {
  constructor(private readonly artifacts: MemoryArtifacts) {}

  async loadManifest(): Promise<KnowledgeManifest> {
    return this.artifacts.manifest;
  }

  async loadSource(manifest: KnowledgeManifest): Promise<KnowledgeSource> {
    const { entries, chunks, symbols, routes } = this.artifacts;
    return { manifest, entries, chunks, symbols, routes };
  }

  async loadLexical(): Promise<LexicalIndexDocument> {
    return this.artifacts.lexical;
  }

  async loadVectors(manifest: KnowledgeManifest): Promise<Float32Array | null> {
    const vectors = this.artifacts.vectors;
    if (!vectors || vectors.length === 0) return null;

    const packed = new Float32Array(vectors.length * manifest.embedding.dimensions);
    for (const [index, vector] of vectors.entries()) packed.set(vector, index * manifest.embedding.dimensions);

    return packed;
  }
}
