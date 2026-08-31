/**
 * Where the compiled knowledge lives, and what it is called.
 *
 * The version is in the path rather than in a query string so a browser
 * holding a cached `v1` never has to be told about `v2` — it asks for a
 * different URL. §87: incompatible changes move the directory, they do not
 * bump a timestamp and hope.
 */

export const ARTIFACT_VERSION = 1;

export const ARTIFACT_BASE = `/copilot/v${ARTIFACT_VERSION}`;

/** Relative to `public/`, so the build and the browser agree by construction. */
export const ARTIFACT_DIR = `copilot/v${ARTIFACT_VERSION}`;

export const ARTIFACTS = {
  manifest: "manifest.json",
  knowledge: "knowledge.json",
  chunks: "chunks.json",
  symbols: "symbols.json",
  routes: "routes.json",
  lexical: "lexical.json",
  vectors: "vectors.bin",
} as const;

export type ArtifactName = keyof typeof ARTIFACTS;

export function artifactUrl(name: ArtifactName): string {
  return `${ARTIFACT_BASE}/${ARTIFACTS[name]}`;
}

/** Where the incremental embedding cache lives, relative to `apps/site`. */
export const EMBEDDING_CACHE_DIR = ".cache/knowledge/embeddings";
