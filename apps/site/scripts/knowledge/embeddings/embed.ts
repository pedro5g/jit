/**
 * The embedding model, running in Node at build time.
 *
 * This is the same weights the browser would run, and that is the point: a
 * query embedded in the browser has to land in the same space as a passage
 * embedded here, or semantic search returns noise that looks like results.
 * What the build does differently is only *when* — §3.2, everything
 * computable in advance is computed in advance.
 *
 * E5 models are trained asymmetrically: a query and a passage are embedded
 * with different prefixes, and dropping them costs a large share of the
 * retrieval quality for no visible symptom. The prefixes live in the model
 * config next to `pipelineVersion`, so changing one forces every cached vector
 * to be recomputed.
 */
import { EMBEDDING_MODEL } from "../../../lib/copilot/config/models";
import type { EmbeddingPort } from "../../../lib/copilot/core/ports/embedding";
import { normalize } from "./binary";

type FeatureExtractor = (
  texts: string[],
  options: { pooling: "mean"; normalize: boolean }
) => Promise<{ dims: number[]; data: Float32Array | number[] }>;

/**
 * How many passages go into one forward pass.
 *
 * Larger batches are faster per item until they are not: the padding is to the
 * longest member, so a batch mixing a two-line chunk with a 1,200-character
 * one spends most of its compute on padding. Sorting by length before batching
 * would help more than raising this, and is worth doing if the build ever gets
 * slow enough to notice.
 */
const BATCH = 16;

export class TransformersEmbedder implements EmbeddingPort {
  private extractor: FeatureExtractor | null = null;

  readonly dimensions = EMBEDDING_MODEL.dimensions;
  readonly modelId = EMBEDDING_MODEL.id;

  private async load(): Promise<FeatureExtractor> {
    if (this.extractor) return this.extractor;

    // Imported lazily so a build that hits the cache for every chunk never
    // pays to load onnxruntime at all — which is the common case, and the
    // difference between a two-second rebuild and a twelve-second one.
    const { pipeline, env } = await import("@huggingface/transformers");
    env.allowLocalModels = false;

    const extractor = (await pipeline("feature-extraction", EMBEDDING_MODEL.repo, {
      dtype: EMBEDDING_MODEL.dtype,
    })) as unknown as FeatureExtractor;

    this.extractor = extractor;
    return extractor;
  }

  private async run(texts: string[]): Promise<Float32Array[]> {
    const extractor = await this.load();
    const output = await extractor(texts, { pooling: "mean", normalize: false });

    const dimensions = output.dims[output.dims.length - 1];
    if (dimensions !== this.dimensions) {
      throw new Error(`${EMBEDDING_MODEL.repo} produced ${dimensions} dimensions, expected ${this.dimensions}`);
    }

    const data = output.data instanceof Float32Array ? output.data : Float32Array.from(output.data);

    return texts.map((_text, index) => normalize(data.slice(index * dimensions, (index + 1) * dimensions)));
  }

  /** A reader's question. */
  async embed(text: string): Promise<Float32Array> {
    const [vector] = await this.run([EMBEDDING_MODEL.queryPrefix + text]);
    return vector;
  }

  /** Documentation passages. */
  async embedAll(
    texts: readonly string[],
    onProgress?: (done: number, total: number) => void
  ): Promise<Float32Array[]> {
    const vectors: Float32Array[] = [];

    for (let start = 0; start < texts.length; start += BATCH) {
      const batch = texts.slice(start, start + BATCH).map((text) => EMBEDDING_MODEL.passagePrefix + text);
      vectors.push(...(await this.run(batch)));
      onProgress?.(vectors.length, texts.length);
    }

    return vectors;
  }
}

/**
 * What actually gets embedded for a chunk.
 *
 * Not the bare content. A chunk taken from halfway down a page has lost the
 * one thing that says what it is about — "Performance" under `equal` and
 * "Performance" under `dto` are the same 600 characters of prose about
 * nanoseconds otherwise. The breadcrumb is cheap and it is the difference
 * between the two embedding to the same point and to different ones.
 */
export function embeddingText(breadcrumb: string, title: string, content: string): string {
  return `${breadcrumb || title}\n\n${content}`;
}
