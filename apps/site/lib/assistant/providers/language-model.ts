import { CHROME_BUILT_IN_LABEL } from "../catalog";
import { systemPrompt, userTurn } from "../prompt";
import type { AssistantProvider, GenerationRequest, ModelStatus, ProgressReporter } from "../types";

/**
 * Chrome's built-in Prompt API. It is not in lib.dom, so the shape this file
 * depends on is declared here — deliberately narrow, so a change in the API
 * surfaces as a type error rather than a runtime one.
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

export function isLanguageModelSupported(): boolean {
  return languageModel() !== null;
}

/**
 * The preferred runtime wherever it exists: the weights are already on the
 * machine and shared with every other site, so the reader downloads nothing.
 */
export class LanguageModelProvider implements AssistantProvider {
  readonly runtime = "chrome-built-in" as const;
  readonly label = CHROME_BUILT_IN_LABEL;

  async availability(): Promise<ModelStatus> {
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

  async prepare(onProgress?: ProgressReporter): Promise<void> {
    const api = languageModel();
    if (!api) throw new Error("This browser has no built-in language model.");

    const session = await api.create({
      monitor: (monitor) => {
        // Chrome reports 0–1 for the shared model download
        monitor.addEventListener("downloadprogress", (event) => onProgress?.(event.loaded * 100));
      },
    });

    session.destroy();
    onProgress?.(100);
  }

  async *generate(request: GenerationRequest): AsyncIterable<string> {
    const api = languageModel();
    if (!api) throw new Error("This browser has no built-in language model.");

    const history = request.messages.slice(0, -1);
    const question = request.messages[request.messages.length - 1];
    if (!question) return;

    const session = await api.create({
      initialPrompts: [
        { role: "system", content: systemPrompt(request.api, request.understanding, request.surface) },
        ...history.map((message) => ({ role: message.role, content: message.content })),
      ],
      signal: request.signal,
    });

    try {
      const stream = session.promptStreaming(
        userTurn({
          question: question.content,
          sections: request.context,
          currentUrl: request.currentUrl,
          editorCode: request.editorCode,
          understanding: request.understanding,
        }),
        { signal: request.signal }
      );

      // The API streams deltas. An earlier revision streamed the whole answer
      // each time, so a chunk that contains everything seen so far is treated
      // as cumulative rather than repeated back to the reader.
      let seen = "";
      for await (const chunk of stream) {
        if (seen && chunk.length > seen.length && chunk.startsWith(seen)) {
          const delta = chunk.slice(seen.length);
          seen = chunk;
          yield delta;
          continue;
        }

        seen += chunk;
        yield chunk;
      }
    } finally {
      session.destroy();
    }
  }
}
