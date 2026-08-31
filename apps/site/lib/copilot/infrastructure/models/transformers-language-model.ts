/**
 * A local model behind `LanguageModelPort`.
 *
 * The port's whole purpose is §100's criterion — swapping the model changes no
 * use case — so everything model-shaped stops here: the chat template, the
 * worker, WebGPU, the download. Above this line there is a `generate` and a
 * `stream`.
 */
import type { GenerationModelSpec } from "../../config/models";
import { CopilotError } from "../../core/errors/copilot-error";
import type { GenerationRequest, GenerationResult, LanguageModelPort } from "../../core/ports/language-model";
import type { CopilotWorkerHost } from "./worker-host";

export class TransformersLanguageModel implements LanguageModelPort {
  constructor(
    private readonly host: CopilotWorkerHost,
    private readonly spec: GenerationModelSpec
  ) {}

  get id() {
    return this.spec.id;
  }

  get label() {
    return this.spec.label;
  }

  generate(request: GenerationRequest): Promise<GenerationResult> {
    return this.stream(request, () => {});
  }

  async stream(request: GenerationRequest, onDelta: (delta: string) => void): Promise<GenerationResult> {
    let text = "";
    let ttftMs = 0;
    let finish: GenerationResult["finish"] = "stop";
    let tokens = 0;
    let totalMs = 0;

    /**
     * An abort is a cancelled answer, not an error.
     *
     * The reader closed the panel or asked something else; the worker is told
     * to stop and whatever streamed already stays on screen. Rejecting here
     * would surface a red banner for an action the reader took deliberately.
     */
    const onAbort = () => this.host.abort();
    request.signal.addEventListener("abort", onAbort, { once: true });

    try {
      await this.host.generate(
        {
          repo: this.spec.repo,
          dtype: this.spec.dtype,
          maxTokens: request.maxTokens,
          temperature: request.temperature,
          messages: request.messages,
        },
        {
          onDelta: (delta) => {
            text += delta;
            onDelta(delta);
          },
          onFirstToken: (ms) => {
            ttftMs = ms;
          },
          onDone: (reason, count, ms) => {
            finish = reason;
            tokens = count;
            totalMs = ms;
          },
        }
      );
    } catch (error) {
      if (request.signal.aborted) return { text, finish: "aborted" };
      throw new CopilotError("generation-failed", error instanceof Error ? error.message : "Generation failed.", {
        model: this.spec.id,
      });
    } finally {
      request.signal.removeEventListener("abort", onAbort);
    }

    return {
      text,
      finish: request.signal.aborted ? "aborted" : finish,
      usage: { completionTokens: tokens },
      timings: {
        ttftMs,
        totalMs,
        tokensPerSecond: totalMs > 0 ? (tokens / totalMs) * 1000 : 0,
      },
    };
  }
}
