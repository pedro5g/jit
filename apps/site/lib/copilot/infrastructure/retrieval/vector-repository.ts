/** Exact dot-product search over normalized vectors in one flat Float32Array. */
import type { VectorMatch, VectorSearchMetrics } from "../../core/entities/retrieval";
import type { VectorRepository } from "../../core/repositories";
import type { ChunkId } from "../../core/value-objects/ids";

export class PackedVectorRepository implements VectorRepository {
  readonly available: boolean;
  lastMetrics: VectorSearchMetrics | null = null;

  constructor(
    private readonly vectors: Float32Array | null,
    private readonly chunkIds: readonly string[],
    readonly dimensions: number
  ) {
    this.available = vectors !== null && vectors.length === chunkIds.length * dimensions;
  }

  search(vector: Float32Array, limit: number): VectorMatch[] {
    const vectors = this.vectors;
    if (!this.available || !vectors || vector.length !== this.dimensions || limit <= 0) {
      this.lastMetrics = null;
      return [];
    }

    const started = performance.now();
    const heapScores = new Float64Array(limit);
    const heapIndexes = new Int32Array(limit);
    let size = 0;

    for (let index = 0; index < this.chunkIds.length; index += 1) {
      const offset = index * this.dimensions;
      let dot = 0;
      for (let dimension = 0; dimension < this.dimensions; dimension += 1) {
        dot += vectors[offset + dimension] * vector[dimension];
      }

      if (size < limit) {
        heapScores[size] = dot;
        heapIndexes[size] = index;
        siftUp(heapScores, heapIndexes, size);
        size += 1;
      } else if (dot > heapScores[0]) {
        heapScores[0] = dot;
        heapIndexes[0] = index;
        siftDown(heapScores, heapIndexes, size, 0);
      }
    }

    const scanFinished = performance.now();
    const best: VectorMatch[] = new Array(size);
    for (let index = 0; index < size; index += 1) {
      best[index] = { chunkId: this.chunkIds[heapIndexes[index]] as ChunkId, score: heapScores[index] };
    }
    best.sort((left, right) => right.score - left.score || left.chunkId.localeCompare(right.chunkId));
    const finished = performance.now();
    this.lastMetrics = {
      vectorCount: this.chunkIds.length,
      dimensions: this.dimensions,
      vectorScanMs: scanFinished - started,
      topKSelectionMs: finished - scanFinished,
      totalMs: finished - started,
      limit,
    };
    return best;
  }
}

function siftUp(scores: Float64Array, indexes: Int32Array, position: number): void {
  while (position > 0) {
    const parent = (position - 1) >> 1;
    if (scores[parent] <= scores[position]) return;
    swap(scores, indexes, parent, position);
    position = parent;
  }
}

function siftDown(scores: Float64Array, indexes: Int32Array, size: number, position: number): void {
  while (true) {
    const left = position * 2 + 1;
    if (left >= size) return;
    const right = left + 1;
    const child = right < size && scores[right] < scores[left] ? right : left;
    if (scores[position] <= scores[child]) return;
    swap(scores, indexes, position, child);
    position = child;
  }
}

function swap(scores: Float64Array, indexes: Int32Array, left: number, right: number): void {
  const score = scores[left];
  scores[left] = scores[right];
  scores[right] = score;
  const index = indexes[left];
  indexes[left] = indexes[right];
  indexes[right] = index;
}
