/// <reference lib="webworker" />
import { type AutoTokenizer, env, pipeline, TextStreamer } from "@huggingface/transformers";
import { EMBEDDING_MODEL, MODEL_CACHE_KEY } from "../../config/models.js";
import { applyOfficialChatTemplate } from "./chat-template.js";
import type { CopilotWorkerRequest, CopilotWorkerResponse } from "./worker-protocol.js";

/**
 * Everything that touches a model runs here.
 *
 * Loading weights and generating tokens both block their thread for seconds at
 * a time, and the documentation page has to keep scrolling while that happens.
 *
 * Cancelling a download is why this worker is disposable: transformers.js
 * offers no way to abort `from_pretrained`, so the client terminates the whole
 * worker instead. Files that finished are already in Cache Storage, so the
 * next attempt resumes rather than restarts.
 */

env.useBrowserCache = true;
env.cacheKey = MODEL_CACHE_KEY;

type Pipeline = Awaited<ReturnType<typeof pipeline>>;
type Tokenizer = Awaited<ReturnType<typeof AutoTokenizer.from_pretrained>>;

const pipelines = new Map<string, Promise<Pipeline>>();
let generationAbort: AbortController | null = null;

function post(response: CopilotWorkerResponse, transfer?: Transferable[]) {
  self.postMessage(response, { transfer: transfer ?? [] });
}

/**
 * Reports bytes, not percentages.
 *
 * The client knows the real total from the repository manifest, so summing
 * what each file has actually transferred is the only number this side needs
 * to produce — and it stays correct when a resumed download skips files
 * entirely, which a percentage does not.
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

function load(task: "text-generation" | "feature-extraction", repo: string, dtype: string, id: number) {
  const key = `${task}:${repo}:${dtype}`;
  const existing = pipelines.get(key);
  if (existing) return existing;

  const created = pipeline(task, repo, {
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

async function generate(request: Extract<CopilotWorkerRequest, { type: "generate" }>) {
  const generator = (await load("text-generation", request.repo, request.dtype, request.id)) as unknown as {
    tokenizer: Tokenizer;
    (input: string, options: Record<string, unknown>): Promise<unknown>;
  };

  generationAbort?.abort();
  generationAbort = new AbortController();
  const { signal } = generationAbort;

  const prompt = applyOfficialChatTemplate(generator.tokenizer, request.messages).prompt;
  const promptTokens = generator.tokenizer.encode(prompt).length;
  const started = performance.now();
  let firstToken = 0;
  let tokens = 0;

  const streamer = new TextStreamer(generator.tokenizer, {
    skip_prompt: true,
    skip_special_tokens: true,
    callback_function: (text: string) => {
      if (signal.aborted || !text) return;

      if (firstToken === 0) {
        firstToken = performance.now() - started;
        post({ id: request.id, type: "first-token", ms: firstToken });
      }

      post({ id: request.id, type: "delta", text });
    },
    token_callback_function: () => {
      tokens += 1;
    },
  });

  await generator(prompt, {
    max_new_tokens: request.maxTokens,
    // Greedy unless asked otherwise. Every answer this thing produces is
    // checked against a fixed surface, and sampling buys variety in exactly
    // the dimension the audit then has to reject.
    do_sample: request.temperature > 0,
    ...(request.temperature > 0 ? { temperature: request.temperature } : {}),
    ...(request.topP !== undefined ? { top_p: request.topP } : {}),
    ...(request.topK !== undefined ? { top_k: request.topK } : {}),
    ...(request.presencePenalty !== undefined ? { presence_penalty: request.presencePenalty } : {}),
    // repetition creeps in on small models once an answer runs long
    repetition_penalty: request.repetitionPenalty ?? 1.1,
    return_full_text: false,
    streamer,
  });

  const aborted = signal.aborted;
  generationAbort = null;

  post({
    id: request.id,
    type: "done",
    finish: aborted ? "aborted" : tokens >= request.maxTokens ? "length" : "stop",
    tokens,
    ms: performance.now() - started,
    promptTokens,
  });
}

/**
 * One query embedding.
 *
 * The `query:` prefix is not decoration. E5 models are trained asymmetrically,
 * and the build embedded every passage with `passage: `; a query embedded
 * without its own prefix lands in a different part of the space, and semantic
 * retrieval returns confident nonsense rather than failing.
 */
async function embedQuery(request: Extract<CopilotWorkerRequest, { type: "embed-query" }>) {
  const extractor = (await load("feature-extraction", request.repo, request.dtype, request.id)) as unknown as (
    texts: string[],
    options: Record<string, unknown>
  ) => Promise<{ data: Float32Array | number[]; dims: number[] }>;

  const output = await extractor([EMBEDDING_MODEL.queryPrefix + request.text], { pooling: "mean", normalize: true });
  const data = output.data instanceof Float32Array ? output.data : Float32Array.from(output.data);

  post({ id: request.id, type: "vector", data }, [data.buffer]);
}

self.onmessage = async (event: MessageEvent<CopilotWorkerRequest>) => {
  const request = event.data;

  try {
    switch (request.type) {
      case "preload-generation":
        await load("text-generation", request.repo, request.dtype, request.id);
        break;
      case "preload-embedding":
        await load("feature-extraction", request.repo, request.dtype, request.id);
        break;
      case "generate":
        await generate(request);
        break;
      case "abort":
        generationAbort?.abort();
        generationAbort = null;
        break;
      case "embed-query":
        await embedQuery(request);
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
