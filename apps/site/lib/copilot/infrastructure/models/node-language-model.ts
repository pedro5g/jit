/**
 * A local model behind `LanguageModelPort`, running on CPU in Node.
 *
 * Its only purpose is measurement. The browser path is WebGPU and a worker;
 * this one exists so the A/B/C benchmark can run headless, on the same
 * `ContextService` output and the same rendered prompt, with no browser to
 * drive and no GPU to depend on.
 *
 * That it satisfies the same port as the WebGPU and Chrome implementations is
 * the point being demonstrated: three runtimes, one application layer, and a
 * benchmark that therefore measures the model rather than the plumbing around
 * it.
 *
 * One caveat, recorded because it shaped the benchmark: `onnxruntime-node`
 * does not register `com.microsoft:CausalConvWithState`, so Qwen3.5-0.8B — the
 * browser's light tier — cannot load here at all. The headless light tier is a
 * different sub-1B model, and the comparison says so.
 */

import { CopilotError } from "../../core/errors/copilot-error";
import type { GenerationRequest, GenerationResult, LanguageModelPort } from "../../core/ports/language-model";

type Generator = ((input: string, options: Record<string, unknown>) => Promise<unknown>) & {
  tokenizer: {
    apply_chat_template(messages: unknown, options: Record<string, unknown>): unknown;
    encode(text: string): number[];
  };
};

export interface NodeModelSpec {
  id: string;
  label: string;
  repo: string;
  dtype: "q4" | "q8" | "fp16";
}

export class NodeLanguageModel implements LanguageModelPort {
  private generator: Generator | null = null;

  constructor(private readonly spec: NodeModelSpec) {}

  get id() {
    return this.spec.id;
  }

  get label() {
    return this.spec.label;
  }

  async load(): Promise<void> {
    if (this.generator) return;

    const { pipeline, env } = await import("@huggingface/transformers");
    env.allowLocalModels = false;

    this.generator = (await pipeline("text-generation", this.spec.repo, {
      dtype: this.spec.dtype,
    })) as unknown as Generator;
  }

  /**
   * The chat template, applied here rather than by the pipeline.
   *
   * A Qwen3 template emits a `<think>` block by default, which would stream
   * straight into the answer; some templates reject a system role outright and
   * need it folded into the first user turn. Both are template arguments, so
   * this is the only place they can be set — and the browser implementation
   * does exactly the same thing, so the two runtimes see the same prompt.
   */
  private prompt(messages: GenerationRequest["messages"]): string {
    const tokenizer = this.generator?.tokenizer;
    if (!tokenizer) throw new CopilotError("model-unavailable", "the model is not loaded");

    const apply = (input: unknown, options: Record<string, unknown>) =>
      tokenizer.apply_chat_template(input, { tokenize: false, add_generation_prompt: true, ...options }) as string;

    try {
      return apply(messages, { enable_thinking: false });
    } catch {
      const folded = messages.map((message) =>
        message.role === "system" ? { role: "user", content: message.content } : message
      );
      return apply(folded, {});
    }
  }

  async generate(request: GenerationRequest): Promise<GenerationResult> {
    await this.load();
    const generator = this.generator;
    if (!generator) throw new CopilotError("model-unavailable", "the model failed to load");

    const prompt = this.prompt(request.messages);
    const promptTokens = generator.tokenizer.encode(prompt).length;

    const started = performance.now();
    const output = (await generator(prompt, {
      max_new_tokens: request.maxTokens,
      do_sample: request.temperature > 0,
      ...(request.temperature > 0 ? { temperature: request.temperature } : {}),
      repetition_penalty: 1.1,
      return_full_text: false,
    })) as { generated_text: string }[];

    const totalMs = performance.now() - started;
    // Qwen3 emits an empty think block even with thinking disabled.
    const text = (output[0]?.generated_text ?? "").replace(/^<think>[\s\S]*?<\/think>\s*/, "").trim();
    const completionTokens = generator.tokenizer.encode(text).length;

    return {
      text,
      finish: completionTokens >= request.maxTokens ? "length" : "stop",
      usage: { promptTokens, completionTokens },
      // No streaming here, so time to first token is not observable. Reporting
      // the total in its place would put a fabricated number in the table.
      timings: { ttftMs: 0, totalMs, tokensPerSecond: totalMs > 0 ? (completionTokens / totalMs) * 1000 : 0 },
    };
  }

  async stream(request: GenerationRequest, onDelta: (delta: string) => void): Promise<GenerationResult> {
    const result = await this.generate(request);
    onDelta(result.text);
    return result;
  }
}
