import type { Locale } from "../value-objects/locale";

/**
 * What a set of knowledge artifacts is, and what it was built from.
 *
 * Loaded first and checked before anything else: artifacts are several files
 * fetched separately, and a browser holding `vectors.bin` from one build and
 * `knowledge.json` from the next silently returns nonsense — the offsets still
 * parse, they just point at the wrong chunks. `contentHash` is what makes that
 * detectable instead of mysterious.
 */
export interface KnowledgeManifest {
  /** Artifact format version. A breaking change moves to `/copilot/v2/`. */
  version: number;
  /** Digest over every chunk. Every artifact in the set carries the same one. */
  contentHash: string;
  builtAt: string;

  embedding: {
    /** Repository id, e.g. `Xenova/multilingual-e5-small`. */
    model: string;
    dimensions: number;
    dtype: "float32";
    /**
     * Bumped by hand when the *pipeline* changes without the model changing —
     * a different pooling, a new prefix, a normalization fix. Part of every
     * embedding hash, so bumping it invalidates the cache on purpose.
     */
    pipelineVersion: number;
  };

  locales: Locale[];

  counts: {
    documents: number;
    entries: number;
    chunks: number;
    symbols: number;
    routes: number;
    relations: number;
    /** Chunks that have a vector. Zero when the build ran without embeddings. */
    vectors: number;
  };

  /** Bytes per artifact, so the loader can show a real progress number. */
  bytes: Record<string, number>;
}
