/**
 * The query embedder, in the browser.
 *
 * Only `embed` is real here. `embedAll` exists because the port declares it —
 * the build uses it for 619 passages — and in the browser it is a mistake
 * waiting to happen: embedding the corpus client-side is the thing §3.2 moved
 * to build time, and the old assistant spent thirty seconds and a progress bar
 * on it every first visit. So it throws rather than quietly working.
 */
import { EMBEDDING_MODEL } from "../../config/models";
import { CopilotError } from "../../core/errors/copilot-error";
import type { EmbeddingPort } from "../../core/ports/embedding";
import type { CopilotWorkerHost } from "../models/worker-host";

export class BrowserEmbedder implements EmbeddingPort {
  readonly dimensions = EMBEDDING_MODEL.dimensions;
  readonly modelId = EMBEDDING_MODEL.id;

  constructor(private readonly host: CopilotWorkerHost) {}

  /** Downloads the weights, reporting bytes so the panel can show progress. */
  preload(onBytes?: (bytes: number) => void): Promise<void> {
    return this.host.preloadEmbedding(EMBEDDING_MODEL.repo, EMBEDDING_MODEL.dtype, onBytes);
  }

  async embed(text: string): Promise<Float32Array> {
    // The `query:` prefix is applied inside the worker, next to the model that
    // needs it, so no caller can forget it and silently degrade retrieval.
    const vector = await this.host.embedQuery(EMBEDDING_MODEL.repo, EMBEDDING_MODEL.dtype, text);

    if (vector.length !== this.dimensions) {
      throw new CopilotError("model-unavailable", `The embedding model returned ${vector.length} dimensions.`, {
        expected: this.dimensions,
      });
    }

    return vector;
  }

  embedAll(): Promise<Float32Array[]> {
    throw new CopilotError(
      "model-unavailable",
      "Passage embeddings are precomputed at build time; the browser only embeds the query."
    );
  }
}
