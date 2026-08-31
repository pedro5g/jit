/**
 * Chrome's built-in Prompt API behind `LanguageModelPort`.
 *
 * The preferred runtime wherever it exists: the weights are already on the
 * machine and shared with every other site, so the reader downloads nothing at
 * all. That makes it the only path to a full copilot on a laptop that will not
 * spare a gigabyte.
 *
 * That this and a 1.7B ONNX model satisfy the same interface is §100's whole
 * point. Nothing above this file knows which one answered.
 */
import { CopilotError } from "../../core/errors/copilot-error";
import type { GenerationRequest, GenerationResult, LanguageModelPort } from "../../core/ports/language-model";

/**
 * The API is not in lib.dom, so the shape this file depends on is declared
 * here — deliberately narrow, so a change surfaces as a type error rather than
 * a runtime one.
 */
interface LanguageModelSession {
  promptStreaming(input: string, options?: { signal?: AbortSignal }): ReadableStream<string>;
  destroy(): void;
}

interface LanguageModelMonitor {
  addEventListener(type: "downloadprogress", listener: (event: { loaded: number }) => void): void;
}

interface LanguageModelStatic {
  availability(): Promise<"unavailable" | "downloadable" | "downloading" | "available">;
  create(options?: {
    initialPrompts?: { role: "system" | "user" | "assistant"; content: string }[];
    monitor?: (monitor: LanguageModelMonitor) => void;
    signal?: AbortSignal;
  }): Promise<LanguageModelSession>;
}

function languageModel(): LanguageModelStatic | null {
  const candidate = (globalThis as { LanguageModel?: LanguageModelStatic }).LanguageModel;
  return candidate && typeof candidate.availability === "function" ? candidate : null;
}

export function isChromeLanguageModelSupported(): boolean {
  return languageModel() !== null;
}

export async function chromeLanguageModelStatus(): Promise<"unsupported" | "needs-download" | "downloading" | "ready"> {
  const api = languageModel();
  if (!api) return "unsupported";

  switch (await api.availability()) {
    case "available":
      return "ready";
    case "downloadable":
      return "needs-download";
    case "downloading":
      return "downloading";
    default:
      return "unsupported";
  }
}

export class ChromeLanguageModel implements LanguageModelPort {
  readonly id = "chrome-built-in";
  readonly label = "Chrome built-in";

  generate(request: GenerationRequest): Promise<GenerationResult> {
    return this.stream(request, () => {});
  }

  async stream(request: GenerationRequest, onDelta: (delta: string) => void): Promise<GenerationResult> {
    const api = languageModel();
    if (!api) throw new CopilotError("model-unavailable", "Chrome's built-in model is not available here.");

    /**
     * The system turn goes in `initialPrompts`, and the rest is one string.
     *
     * The session API takes prior turns as initial prompts and the new turn as
     * the prompt itself; there is no message array on `promptStreaming`. So
     * the split has to happen here rather than in the renderer, which is
     * exactly the kind of per-backend difference the port exists to hide.
     */
    const initialPrompts = request.messages.slice(0, -1).map((message) => ({
      role: message.role,
      content: message.content,
    }));
    const last = request.messages[request.messages.length - 1];

    const started = performance.now();
    let ttftMs = 0;
    let text = "";

    const session = await api.create({
      ...(initialPrompts.length > 0 ? { initialPrompts } : {}),
      signal: request.signal,
    });

    try {
      for await (const chunk of readAll(session.promptStreaming(last?.content ?? "", { signal: request.signal }))) {
        if (ttftMs === 0) ttftMs = performance.now() - started;
        text += chunk;
        onDelta(chunk);
      }
    } catch (error) {
      if (request.signal.aborted) return { text, finish: "aborted" };
      throw new CopilotError("generation-failed", error instanceof Error ? error.message : "Generation failed.");
    } finally {
      session.destroy();
    }

    const totalMs = performance.now() - started;

    return {
      text,
      finish: request.signal.aborted ? "aborted" : "stop",
      // The API reports no token count, so tokens/sec is not knowable here.
      // Reporting an estimate would put a fabricated number in §76's table.
      timings: { ttftMs, totalMs, tokensPerSecond: 0 },
    };
  }
}

async function* readAll(stream: ReadableStream<string>): AsyncGenerator<string> {
  const reader = stream.getReader();

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return;
      if (value) yield value;
    }
  } finally {
    reader.releaseLock();
  }
}
