/**
 * A local model behind `LanguageModelPort`.
 *
 * The port's whole purpose is §100's criterion — swapping the model changes no
 * use case — so everything model-shaped stops here: the chat template, the
 * worker, WebGPU, the download. Above this line there is a `generate` and a
 * `stream`.
 */
import type { GenerationCandidate } from "../../config/models.js";
import { CopilotError } from "../../core/errors/copilot-error.js";
import type { GenerationRequest, GenerationResult, LanguageModelPort } from "../../core/ports/language-model.js";
import type { CopilotWorkerHost } from "./worker-host.js";

export class TransformersLanguageModel implements LanguageModelPort {
  constructor(
    private readonly host: CopilotWorkerHost,
    private readonly spec: GenerationCandidate
  ) {
    if (spec.provider !== "transformers-webgpu" || !spec.model || !spec.dtype) {
      throw new Error("TransformersLanguageModel requires a downloadable Transformers candidate");
    }
  }

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
    const repo = this.spec.model;
    const dtype = this.spec.dtype;
    if (!repo || !dtype) throw new CopilotError("model-unavailable", "the model has no checkpoint or dtype");

    let text = "";
    let ttftMs = 0;
    let finish: GenerationResult["finish"] = "stop";
    let tokens = 0;
    let promptTokens: number | undefined;
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
          repo,
          dtype,
          maxTokens: request.maxTokens,
          temperature: request.temperature,
          ...(request.topP !== undefined ? { topP: request.topP } : {}),
          ...(request.topK !== undefined ? { topK: request.topK } : {}),
          ...(request.presencePenalty !== undefined ? { presencePenalty: request.presencePenalty } : {}),
          ...(request.repetitionPenalty !== undefined ? { repetitionPenalty: request.repetitionPenalty } : {}),
          ...(request.decodingId ? { decodingId: request.decodingId } : {}),
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
          onDone: (reason, count, ms, promptCount) => {
            finish = reason;
            tokens = count;
            promptTokens = promptCount;
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
      usage: { ...(promptTokens !== undefined ? { promptTokens } : {}), completionTokens: tokens },
      timings: {
        ttftMs,
        totalMs,
        tokensPerSecond: totalMs > 0 ? (tokens / totalMs) * 1000 : 0,
      },
    };
  }
}
