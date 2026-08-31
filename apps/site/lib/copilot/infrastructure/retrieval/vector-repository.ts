/**
 * Brute-force cosine similarity over the packed vectors.
 *
 * §31 and §32 are explicit that this stays brute force until a benchmark says
 * otherwise, and the arithmetic backs them up: 619 chunks at 384 dimensions is
 * 238,000 multiply-adds over one contiguous Float32Array — roughly a tenth of
 * a millisecond, next to the tens of milliseconds it takes to embed the query
 * that gets compared. An ANN index would optimise 0.4% of the latency and add
 * a structure that has to be rebuilt, versioned and validated.
 *
 * The vectors are stored normalized, so the dot product *is* the cosine and
 * there is no magnitude to divide by.
 */
import type { VectorMatch } from "../../core/entities/retrieval";
import type { VectorRepository } from "../../core/repositories";
import type { ChunkId } from "../../core/value-objects/ids";

export class PackedVectorRepository implements VectorRepository {
  readonly available: boolean;

  constructor(
    private readonly vectors: Float32Array | null,
    private readonly chunkIds: readonly string[],
    readonly dimensions: number
  ) {
    // A truncated file is worse than a missing one: the offsets still resolve
    // and every result is silently drawn from the wrong chunk.
    this.available = vectors !== null && vectors.length === chunkIds.length * dimensions;
  }

  search(vector: Float32Array, limit: number): VectorMatch[] {
    const vectors = this.vectors;
    if (!this.available || !vectors || vector.length !== this.dimensions) return [];

    /**
     * A bounded insertion sort beats sorting the whole corpus.
     *
     * `limit` is 20; scoring 619 candidates and sorting them is 619 log 619
     * comparisons to discard 599 of them. Keeping a small ordered array costs
     * at most `limit` shifts per accepted candidate, and most candidates are
     * rejected by one comparison against the worst kept score.
     */
    const best: VectorMatch[] = [];
    let worst = -Infinity;

    for (let index = 0; index < this.chunkIds.length; index++) {
      const offset = index * this.dimensions;

      let dot = 0;
      for (let dimension = 0; dimension < this.dimensions; dimension++) {
        dot += vectors[offset + dimension] * vector[dimension];
      }

      if (best.length === limit && dot <= worst) continue;

      const match: VectorMatch = { chunkId: this.chunkIds[index] as ChunkId, score: dot };
      let position = best.length;
      while (position > 0 && best[position - 1].score < dot) position -= 1;

      best.splice(position, 0, match);
      if (best.length > limit) best.pop();
      worst = best[best.length - 1].score;
    }

    return best;
  }
}
