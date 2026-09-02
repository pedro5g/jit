import type { KnowledgeRelation } from "../entities/knowledge-relation";
import type { KnowledgeManifest } from "../entities/manifest";
import type { KnowledgeSource } from "../repositories";

/**
 * Where the static knowledge artifacts come from.
 *
 * `fetch` in the browser, `readFile` in the build and in tests. The
 * distinction matters more than it looks: the eval suite runs the entire
 * retrieval stack against artifacts read off disk, with no browser and no
 * network, which is what makes retrieval testable without a headless Chrome.
 */
export interface ArtifactLoaderPort {
  loadManifest(): Promise<KnowledgeManifest>;
  loadSource(manifest: KnowledgeManifest): Promise<KnowledgeSource>;
  loadRelations(manifest: KnowledgeManifest): Promise<KnowledgeRelation[]>;
  /** The packed Float32 vectors, or null when the build shipped without them. */
  loadVectors(manifest: KnowledgeManifest): Promise<Float32Array | null>;
}
