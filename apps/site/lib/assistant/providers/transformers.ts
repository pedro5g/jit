import type { GenerationModel } from "../catalog";
import { inspectModel, loadManifest } from "../model-store";
import { foldSystemIntoFirstTurn, systemPrompt, userTurn } from "../prompt";
import type { AssistantProvider, GenerationRequest, ModelStatus, ProgressReporter } from "../types";
import type { AssistantWorkerRequest, AssistantWorkerResponse } from "../worker/protocol";

/** `Omit` over a union collapses it, so the id is dropped per member. */
type WorkerCall = AssistantWorkerRequest extends infer T ? (T extends { id: number } ? Omit<T, "id"> : never) : never;

interface PendingRequest {
  resolve: () => void;
  reject: (error: Error) => void;
  onBytes?: ((loadedBytes: number) => void) | undefined;
  onDelta?: ((text: string) => void) | undefined;
  onVectors?: ((vectors: Float32Array[]) => void) | undefined;
}

/** Thrown when the reader cancels; the UI shows no error for it. */
export class CancelledError extends Error {
  constructor() {
    super("cancelled");
    this.name = "CancelledError";
  }
}

/**
 * Owns the single worker every local model runs in, and turns its message
 * protocol back into promises and async iterables.
 */
export class TransformersRuntime {
  private worker: Worker | null = null;
  private nextId = 1;
  private readonly pending = new Map<number, PendingRequest>();

  private ensureWorker(): Worker {
    if (this.worker) return this.worker;

    const worker = new Worker(new URL("../worker/transformers.worker.ts", import.meta.url), { type: "module" });

    worker.onmessage = (event: MessageEvent<AssistantWorkerResponse>) => {
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
        case "vectors": {
          const vectors: Float32Array[] = [];
          for (let offset = 0; offset < response.data.length; offset += response.dimensions) {
            vectors.push(response.data.subarray(offset, offset + response.dimensions));
          }
          request.onVectors?.(vectors);
          break;
        }
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

    worker.onerror = (event) => this.failAll(new Error(event.message || "The local model worker crashed."));

    this.worker = worker;
    return worker;
  }

  private failAll(error: Error) {
    for (const [id, request] of this.pending) {
      this.pending.delete(id);
      request.reject(error);
    }
  }

  private send(request: WorkerCall, handlers: Omit<PendingRequest, "resolve" | "reject"> = {}): Promise<void> {
    const worker = this.ensureWorker();
    const id = this.nextId++;

    return new Promise<void>((resolve, reject) => {
      this.pending.set(id, { resolve, reject, ...handlers });
      worker.postMessage({ ...request, id } as AssistantWorkerRequest);
    });
  }

  /**
   * The only way to stop a download in flight: transformers.js cannot abort
   * `from_pretrained`, so the worker holding it is destroyed. Completed files
   * stay in Cache Storage, so this cancels without throwing away progress.
   */
  cancel() {
    this.worker?.terminate();
    this.worker = null;
    this.failAll(new CancelledError());
  }

  preload(model: GenerationModel, onBytes?: (loadedBytes: number) => void) {
    return this.send({ type: "preload", modelId: model.repo, dtype: model.dtype }, { onBytes });
  }

  preloadEmbeddings(onBytes?: (loadedBytes: number) => void) {
    return this.send({ type: "preload-embeddings" }, { onBytes });
  }

  async embed(texts: string[]): Promise<Float32Array[]> {
    let vectors: Float32Array[] = [];
    await this.send({ type: "embed", texts }, { onVectors: (result) => (vectors = result) });
    return vectors;
  }

  generate(
    model: GenerationModel,
    messages: { role: string; content: string }[],
    maxTokens: number,
    signal: AbortSignal
  ): AsyncIterable<string> {
    const queue: string[] = [];
    let notify: (() => void) | null = null;
    let done = false;
    let failure: Error | null = null;

    const wake = () => {
      notify?.();
      notify = null;
    };

    this.send(
      { type: "generate-text", modelId: model.repo, dtype: model.dtype, maxTokens, messages },
      {
        onDelta: (text) => {
          queue.push(text);
          wake();
        },
      }
    ).then(
      () => {
        done = true;
        wake();
      },
      (error: Error) => {
        failure = error;
        done = true;
        wake();
      }
    );

    const abort = () => {
      void this.send({ type: "abort-generation" }).catch(() => undefined);
      done = true;
      wake();
    };
    signal.addEventListener("abort", abort, { once: true });

    return {
      async *[Symbol.asyncIterator]() {
        try {
          while (true) {
            while (queue.length > 0) yield queue.shift() as string;
            if (failure) throw failure;
            if (done) return;
            await new Promise<void>((resolve) => {
              notify = resolve;
            });
          }
        } finally {
          signal.removeEventListener("abort", abort);
        }
      },
    };
  }

  dispose() {
    this.worker?.terminate();
    this.worker = null;
    this.pending.clear();
  }
}

/** WebGPU is the only backend worth offering: wasm generation is unusably slow. */
export function isWebGpuAvailable(): boolean {
  return typeof navigator !== "undefined" && "gpu" in navigator;
}

/** A local model through transformers.js — the fallback outside Chrome. */
export class TransformersProvider implements AssistantProvider {
  readonly runtime = "webgpu-transformers" as const;
  /**
   * A pipeline that loaded in this session is ready, full stop. Cache
   * inspection is an optimization for a returning reader — it must never be
   * the reason a model the worker is holding in memory reports itself as
   * missing, which is what happens the moment a repository names a file the
   * pipeline never fetches.
   */
  private loaded = false;

  constructor(
    private readonly host: TransformersRuntime,
    readonly model: GenerationModel
  ) {}

  get label() {
    return this.model.label;
  }

  /** The cache is the source of truth, so a returning reader waits for nothing. */
  async availability(): Promise<ModelStatus> {
    if (!isWebGpuAvailable()) return "unsupported";
    if (this.loaded) return "ready";

    const presence = await inspectModel(this.model);
    return presence.complete ? "ready" : "needs-download";
  }

  async prepare(onProgress?: ProgressReporter): Promise<void> {
    const [manifest, presence] = await Promise.all([
      loadManifest(this.model).catch(() => null),
      inspectModel(this.model),
    ]);

    const totalBytes = manifest?.totalBytes ?? this.model.approximateBytes;
    // files already cached are never re-fetched, so they start the bar filled
    const alreadyHave = presence.cachedBytes;

    onProgress?.((alreadyHave / totalBytes) * 100, { loadedBytes: alreadyHave, totalBytes });

    await this.host.preload(this.model, (loadedBytes) => {
      const total = Math.max(totalBytes, alreadyHave + loadedBytes);
      onProgress?.(((alreadyHave + loadedBytes) / total) * 100, {
        loadedBytes: alreadyHave + loadedBytes,
        totalBytes: total,
      });
    });

    this.loaded = true;
    onProgress?.(100, { loadedBytes: totalBytes, totalBytes });
  }

  generate(request: GenerationRequest): AsyncIterable<string> {
    const history = request.messages.slice(0, -1);
    const question = request.messages[request.messages.length - 1];

    const turn = userTurn({
      question: question?.content ?? "",
      sections: request.context,
      currentUrl: request.currentUrl,
      editorCode: request.editorCode,
      understanding: request.understanding,
    });

    const messages =
      this.model.family === "gemma"
        ? [
            ...history,
            {
              role: "user",
              content: foldSystemIntoFirstTurn(turn, request.api, request.understanding, request.surface),
            },
          ]
        : [
            { role: "system", content: systemPrompt(request.api, request.understanding, request.surface) },
            ...history,
            { role: "user", content: turn },
          ];

    return this.host.generate(this.model, messages, request.maxTokens, request.signal);
  }
}
