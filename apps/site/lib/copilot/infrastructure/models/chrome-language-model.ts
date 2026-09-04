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
import { CopilotError } from "../../core/errors/copilot-error.js";
import type { GenerationRequest, GenerationResult } from "../../core/ports/language-model.js";
import type {
  LanguageModelAvailability,
  LanguageModelPreparation,
  LanguageModelProviderPort,
} from "../../core/ports/language-model-provider.js";

/**
 * The API is not in lib.dom, so the shape this file depends on is declared
 * here — deliberately narrow, so a change surfaces as a type error rather than
 * a runtime one.
 */
interface LanguageModelSession {
  promptStreaming(
    input: string,
    options?: { signal?: AbortSignal; responseConstraint?: unknown }
  ): ReadableStream<string>;
  contextUsage?: number;
  contextWindow?: number;
  destroy(): void;
}

interface LanguageModelMonitor {
  addEventListener(type: "downloadprogress", listener: (event: { loaded: number }) => void): void;
}

interface LanguageModelStatic {
  availability(
    options?: Record<string, unknown>
  ): Promise<"unavailable" | "downloadable" | "downloading" | "available">;
  create(options?: {
    initialPrompts?: { role: "system" | "user" | "assistant"; content: string }[];
    monitor?: (monitor: LanguageModelMonitor) => void;
    signal?: AbortSignal;
    samplingMode?: string;
  }): Promise<LanguageModelSession>;
}

export type ChromeLanguageModelAvailability = "unavailable" | "downloadable" | "downloading" | "available";

export interface ChromeLanguageModelPreparation {
  availability: ChromeLanguageModelAvailability | "unsupported";
  downloadProgress?: (fraction: number) => void;
}

function languageModel(): LanguageModelStatic | null {
  const candidate = (globalThis as { LanguageModel?: LanguageModelStatic }).LanguageModel;
  return candidate && typeof candidate.availability === "function" ? candidate : null;
}

export function isChromeLanguageModelSupported(): boolean {
  return languageModel() !== null;
}

export async function chromeLanguageModelStatus(): Promise<LanguageModelAvailability> {
  const api = languageModel();
  if (!api) return "unsupported";

  try {
    switch (await api.availability()) {
      case "available":
        return "ready";
      case "downloadable":
        return "needs-download";
      case "downloading":
        return "downloading";
      case "unavailable":
        return "unavailable";
    }
  } catch {
    return "unavailable";
  }
}

export class ChromeLanguageModel implements LanguageModelProviderPort {
  readonly id = "chrome-language-model";
  readonly label = "Chrome LanguageModel · Gemini Nano";
  private activeSession: LanguageModelSession | null = null;
  private abortRequested = false;
  private _lastSessionCreateMs: number | undefined;
  private _lastAvailabilityDetail: string | undefined;

  get lastSessionCreateMs() {
    return this._lastSessionCreateMs;
  }

  get lastAvailabilityDetail() {
    return this._lastAvailabilityDetail;
  }

  async availability(): Promise<LanguageModelAvailability> {
    const api = languageModel();
    if (!api) return "unsupported";
    try {
      return await api.availability().then((status) => {
        switch (status) {
          case "available":
            return "ready";
          case "downloadable":
            return "needs-download";
          case "downloading":
            return "downloading";
          case "unavailable":
            return "unavailable";
        }
      });
    } catch (error) {
      this._lastAvailabilityDetail = error instanceof Error ? error.message : "LanguageModel.availability() failed.";
      return "unavailable";
    }
  }

  /** Initializes the browser model and reports only the progress the API exposes. */
  async initialize(onDownloadProgress?: (fraction: number) => void): Promise<LanguageModelPreparation> {
    const api = languageModel();
    if (!api) return "unsupported";

    let availability: ChromeLanguageModelAvailability;
    try {
      availability = await api.availability();
    } catch (error) {
      this._lastAvailabilityDetail = error instanceof Error ? error.message : "LanguageModel.availability() failed.";
      return "unavailable";
    }
    if (availability === "unavailable") {
      this._lastAvailabilityDetail = "LanguageModel.availability() returned unavailable.";
      return availability;
    }
    // `create()` is the API's user-activated download/init boundary. The
    // session is intentionally destroyed immediately: P is single-turn and
    // must not inherit state from preparation.
    const started = performance.now();
    let session: LanguageModelSession;
    try {
      session = await api.create({
        monitor: (monitor) =>
          monitor.addEventListener("downloadprogress", (event) => onDownloadProgress?.(event.loaded)),
      });
    } catch (error) {
      this._lastAvailabilityDetail = error instanceof Error ? error.message : "LanguageModel.create() failed.";
      return "unavailable";
    }
    this._lastSessionCreateMs = performance.now() - started;
    session.destroy();
    return "available";
  }

  generate(request: GenerationRequest): Promise<GenerationResult> {
    return this.stream(request, () => {});
  }

  async stream(request: GenerationRequest, onDelta: (delta: string) => void): Promise<GenerationResult> {
    const api = languageModel();
    if (!api) throw new CopilotError("model-unavailable", "Chrome's built-in model is not available here.");
    if (request.signal.aborted) return { text: "", finish: "aborted" };

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

    let session: LanguageModelSession;
    try {
      const sessionStarted = performance.now();
      session = await api.create({
        ...(initialPrompts.length > 0 ? { initialPrompts } : {}),
        signal: request.signal,
      });
      this._lastSessionCreateMs = performance.now() - sessionStarted;
    } catch (error) {
      if (request.signal.aborted) return { text: "", finish: "aborted" };
      throw new CopilotError("generation-failed", error instanceof Error ? error.message : "Generation failed.");
    }
    this.activeSession = session;
    this.abortRequested = false;

    try {
      for await (const chunk of readAll(
        session.promptStreaming(last?.content ?? "", {
          signal: request.signal,
          ...(request.responseSchema ? { responseConstraint: request.responseSchema } : {}),
        })
      )) {
        if (ttftMs === 0) ttftMs = performance.now() - started;
        text += chunk;
        onDelta(chunk);
      }
    } catch (error) {
      if (request.signal.aborted || this.abortRequested) return { text, finish: "aborted" };
      throw new CopilotError("generation-failed", error instanceof Error ? error.message : "Generation failed.");
    } finally {
      if (this.activeSession === session) this.activeSession = null;
      session.destroy();
      this.abortRequested = false;
    }

    const totalMs = performance.now() - started;

    return {
      text,
      finish: request.signal.aborted || this.abortRequested ? "aborted" : "stop",
      // The API reports no token count, so tokens/sec is not knowable here.
      // Reporting an estimate would put a fabricated number in §76's table.
      timings: { ...(ttftMs > 0 ? { ttftMs } : {}), totalMs },
    };
  }

  /** Abort is explicit because the browser API cancels by destroying a session. */
  abort() {
    this.abortRequested = true;
    this.activeSession?.destroy();
    this.activeSession = null;
  }

  dispose() {
    this.abort();
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
