/**
 * The text that gets hashed, and why it is not the text that gets read.
 *
 * An incremental build is only worth having if it is stable: reflowing a
 * paragraph, changing a smart quote or adding a trailing space must not
 * recompute an embedding. So the hash is taken over a normalized form —
 * whitespace collapsed, quotes folded — while the chunk keeps the original,
 * because the original is what a reader is shown and what a model reads.
 */
import { createHash } from "node:crypto";

const SINGLE_QUOTES = /[‘’]/g;
const DOUBLE_QUOTES = /[“”]/g;

export function normalizeForHash(text: string): string {
  return text
    .replace(/\r\n/g, "\n")
    .replace(SINGLE_QUOTES, "'")
    .replace(DOUBLE_QUOTES, '"')
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function sha256(...parts: string[]): string {
  const hash = createHash("sha256");
  for (const part of parts) hash.update(part).update("\0");
  return hash.digest("hex");
}

/** A short digest, for ids and filenames where 64 hex characters are noise. */
export function digest(...parts: string[]): string {
  return sha256(...parts).slice(0, 16);
}

/**
 * The key an embedding is cached under (§19).
 *
 * Content, model and pipeline version, together. Two chunks with identical
 * text share one cached vector for free, and a change to the model or to the
 * prefixes the pipeline applies invalidates every entry — which it must,
 * because a cache holding vectors from two different models is not slow, it is
 * silently wrong.
 */
export function embeddingHash(content: string, modelId: string, pipelineVersion: number): string {
  return sha256(normalizeForHash(content), modelId, String(pipelineVersion)).slice(0, 32);
}
