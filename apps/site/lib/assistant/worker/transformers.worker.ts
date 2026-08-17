/// <reference lib="webworker" />
import { type AutoTokenizer, env, pipeline, TextStreamer } from "@huggingface/transformers";
import { EMBEDDING_MODEL, TRANSFORMERS_CACHE_KEY } from "../catalog";
import type { AssistantWorkerRequest, AssistantWorkerResponse } from "./protocol";

/**
 * Everything that touches a model runs here. Loading weights and generating
 * tokens both block their thread for seconds at a time, and the docs page has
 * to keep scrolling while that happens.
 *
 * Cancelling a download is why this worker is disposable: transformers.js
 * offers no way to abort `from_pretrained`, so the client terminates the whole
 * worker instead. Files that finished are already in Cache Storage, so the
 * next attempt resumes rather than restarts.
 */

env.useBrowserCache = true;
env.cacheKey = TRANSFORMERS_CACHE_KEY;

type Pipeline = Awaited<ReturnType<typeof pipeline>>;
type Tokenizer = Awaited<ReturnType<typeof AutoTokenizer.from_pretrained>>;

const pipelines = new Map<string, Promise<Pipeline>>();
let generationAbort: AbortController | null = null;

function post(response: AssistantWorkerResponse, transfer?: Transferable[]) {
  self.postMessage(response, { transfer: transfer ?? [] });
}

/**
 * Reports bytes, not percentages. The client knows the real total from the
 * repository manifest, so summing what each file has actually transferred is
 * the only number this side needs to produce — and it stays correct when a
 * resumed download skips files entirely.
 */
function progressReporter(id: number) {
  const perFile = new Map<string, number>();

  return (event: unknown) => {
    if (!event || typeof event !== "object") return;
    const { status, file, loaded } = event as { status?: string; file?: string; loaded?: number };
    if (status !== "progress" || !file || typeof loaded !== "number") return;

    perFile.set(file, loaded);
    let bytes = 0;
    for (const value of perFile.values()) bytes += value;

    post({ id, type: "progress", loadedBytes: bytes });
  };
}

function load(task: "text-generation" | "feature-extraction", modelId: string, dtype: string, id: number) {
  const key = `${task}:${modelId}:${dtype}`;
  const existing = pipelines.get(key);
  if (existing) return existing;

  const created = pipeline(task, modelId, {
    dtype: dtype as "q4f16",
    device: "webgpu",
    progress_callback: progressReporter(id),
  }).catch((error: unknown) => {
    // a failed load must not be cached, or every retry replays the failure
    pipelines.delete(key);
    throw error;
  });

  pipelines.set(key, created);
  return created;
}

/**
 * Applies the chat template here rather than letting the pipeline do it, for
 * two reasons: a Qwen3 template defaults to emitting a `<think>` block that
 * would stream into the answer, and Gemma's template rejects a system role
 * outright. Both are template arguments, not generation arguments, so this is
 * the only place they can be set.
 */
function buildPrompt(tokenizer: Tokenizer, messages: { role: string; content: string }[]) {
  const apply = (input: { role: string; content: string }[], options: Record<string, unknown>) =>
    tokenizer.apply_chat_template(input, {
      tokenize: false,
      add_generation_prompt: true,
      ...options,
    }) as string;

  try {
    return apply(messages, { enable_thinking: false });
  } catch {
    // no system role in this template: fold it into the first user turn
    const folded = messages.map((message, index) =>
      message.role === "system"
        ? { role: "user", content: message.content }
        : index === 1 && messages[0]?.role === "system"
          ? { role: message.role, content: message.content }
          : message
    );

    return apply(folded, {});
  }
}

async function generate(request: Extract<AssistantWorkerRequest, { type: "generate-text" }>) {
  const generator = (await load("text-generation", request.modelId, request.dtype, request.id)) as unknown as {
    tokenizer: Tokenizer;
    (input: string, options: Record<string, unknown>): Promise<unknown>;
  };

  generationAbort?.abort();
  generationAbort = new AbortController();
  const { signal } = generationAbort;

  const streamer = new TextStreamer(generator.tokenizer, {
    skip_prompt: true,
    skip_special_tokens: true,
    callback_function: (text: string) => {
      if (!signal.aborted && text) post({ id: request.id, type: "delta", text });
    },
  });

  await generator(buildPrompt(generator.tokenizer, request.messages), {
    max_new_tokens: request.maxTokens,
    do_sample: false,
    // repetition creeps in on small models once an answer runs long
    repetition_penalty: 1.1,
    return_full_text: false,
    streamer,
  });

  generationAbort = null;
}

async function embed(request: Extract<AssistantWorkerRequest, { type: "embed" }>) {
  const extractor = (await load(
    "feature-extraction",
    EMBEDDING_MODEL.repo,
    EMBEDDING_MODEL.dtype,
    request.id
  )) as unknown as (
    texts: string[],
    options: Record<string, unknown>
  ) => Promise<{
    data: Float32Array | number[];
    dims: number[];
  }>;

  const output = await extractor(request.texts, { pooling: "mean", normalize: true });
  const dimensions = output.dims[output.dims.length - 1];
  const data = output.data instanceof Float32Array ? output.data : Float32Array.from(output.data);

  post({ id: request.id, type: "vectors", data, dimensions }, [data.buffer]);
}

self.onmessage = async (event: MessageEvent<AssistantWorkerRequest>) => {
  const request = event.data;

  try {
    switch (request.type) {
      case "preload":
        await load("text-generation", request.modelId, request.dtype, request.id);
        break;
      case "generate-text":
        await generate(request);
        break;
      case "abort-generation":
        generationAbort?.abort();
        generationAbort = null;
        break;
      case "preload-embeddings":
        await load("feature-extraction", EMBEDDING_MODEL.repo, EMBEDDING_MODEL.dtype, request.id);
        break;
      case "embed":
        await embed(request);
        break;
    }

    post({ id: request.id, type: "result" });
  } catch (error) {
    post({
      id: request.id,
      type: "error",
      message: error instanceof Error ? error.message : "The local model worker failed.",
    });
  }
};
