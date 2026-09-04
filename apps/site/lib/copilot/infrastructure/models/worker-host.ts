/**
 * The single worker every local model runs in, and the promise interface over
 * its message protocol.
 *
 * One worker rather than one per model: the generation model and the embedding
 * model are both ONNX runtimes competing for the same GPU, and two workers
 * means two WebGPU device requests and two copies of the runtime in memory.
 * The pipelines are cached inside it by task and repo, so switching models
 * keeps the one already loaded.
 */
import type { CopilotWorkerRequest, CopilotWorkerResponse } from "./worker-protocol.js";

/** `Omit` over a union collapses it, so the id is dropped per member. */
type WorkerCall = CopilotWorkerRequest extends infer T ? (T extends { id: number } ? Omit<T, "id"> : never) : never;

interface Pending {
  resolve: () => void;
  reject: (error: Error) => void;
  onBytes?: (loadedBytes: number) => void;
  onDelta?: (text: string) => void;
  onFirstToken?: (ms: number) => void;
  onVector?: (vector: Float32Array) => void;
  onDone?: (finish: "stop" | "length" | "aborted", tokens: number, ms: number, promptTokens?: number) => void;
}

/** Thrown when the reader cancels; the UI shows no error for it. */
export class CancelledError extends Error {
  constructor() {
    super("cancelled");
    this.name = "CancelledError";
  }
}

export class CopilotWorkerHost {
  private worker: Worker | null = null;
  private nextId = 1;
  private readonly pending = new Map<number, Pending>();

  private ensureWorker(): Worker {
    if (this.worker) return this.worker;

    const worker = new Worker(new URL("./copilot.worker.ts", import.meta.url), { type: "module" });

    worker.onmessage = (event: MessageEvent<CopilotWorkerResponse>) => {
      const response = event.data;
      const request = this.pending.get(response.id);
      if (!request) return;

      switch (response.type) {
        case "progress":
          request.onBytes?.(response.loadedBytes);
          break;
        case "delta":
          request.onDelta?.(response.text);
          break;
        case "first-token":
          request.onFirstToken?.(response.ms);
          break;
        case "vector":
          request.onVector?.(response.data);
          break;
        case "done":
          request.onDone?.(response.finish, response.tokens, response.ms, response.promptTokens);
          break;
        case "result":
          this.pending.delete(response.id);
          request.resolve();
          break;
        case "error":
          this.pending.delete(response.id);
          request.reject(new Error(response.message));
          break;
      }
    };

    this.worker = worker;
    return worker;
  }

  private call(request: WorkerCall, handlers: Omit<Pending, "resolve" | "reject"> = {}): Promise<void> {
    const id = this.nextId++;
    const worker = this.ensureWorker();

    return new Promise<void>((resolve, reject) => {
      this.pending.set(id, { resolve, reject, ...handlers });
      worker.postMessage({ ...request, id } as CopilotWorkerRequest);
    });
  }

  preloadGeneration(repo: string, dtype: string, onBytes?: (bytes: number) => void) {
    return this.call({ type: "preload-generation", repo, dtype }, onBytes ? { onBytes } : {});
  }

  preloadEmbedding(repo: string, dtype: string, onBytes?: (bytes: number) => void) {
    return this.call({ type: "preload-embedding", repo, dtype }, onBytes ? { onBytes } : {});
  }

  async embedQuery(repo: string, dtype: string, text: string): Promise<Float32Array> {
    let vector: Float32Array | null = null;
    await this.call({ type: "embed-query", repo, dtype, text }, { onVector: (value) => (vector = value) });

    if (!vector) throw new Error("the embedding model returned nothing");
    return vector;
  }

  generate(
    request: Omit<Extract<CopilotWorkerRequest, { type: "generate" }>, "id" | "type">,
    handlers: Pick<Pending, "onDelta" | "onFirstToken" | "onDone">
  ) {
    return this.call({ type: "generate", ...request }, handlers);
  }

  abort() {
    if (this.worker) void this.call({ type: "abort" }).catch(() => {});
  }

  /**
   * Kills the worker mid-download.
   *
   * transformers.js cannot abort `from_pretrained`, so the only way to stop a
   * gigabyte in flight is to terminate the thread. Whatever completed is
   * already in Cache Storage, so the next attempt resumes.
   */
  cancelDownload() {
    if (!this.worker) return;

    this.worker.terminate();
    this.worker = null;

    for (const request of this.pending.values()) request.reject(new CancelledError());
    this.pending.clear();
  }

  dispose() {
    this.worker?.terminate();
    this.worker = null;
    this.pending.clear();
  }
}
