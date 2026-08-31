/**
 * Turning text into a vector — the one thing the engine cannot do itself.
 *
 * The core knows this interface and nothing about how it is satisfied. Behind
 * it, today, is transformers.js on WebGPU in the browser and the same model on
 * CPU in the build script; the point is that neither of those words appears
 * anywhere in `application/`.
 */
export interface EmbeddingPort {
  /**
   * One vector, L2-normalized, of exactly `dimensions` length.
   *
   * Normalization is the port's responsibility rather than the caller's
   * because it has to match what the build script stored — the vector search
   * takes a dot product and calls it a cosine, and that is only true if both
   * sides normalized.
   */
  embed(text: string): Promise<Float32Array>;

  /** Batched, for the build. Order matches the input. */
  embedAll(texts: readonly string[], onProgress?: (done: number, total: number) => void): Promise<Float32Array[]>;

  readonly dimensions: number;
  /** Must match `manifest.embedding.model`, or the vectors are incomparable. */
  readonly modelId: string;
}
