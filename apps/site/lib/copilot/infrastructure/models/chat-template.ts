/**
 * One adapter for checkpoint-owned chat templates.
 *
 * A qualification must compare model weights after the tokenizer has framed
 * their messages correctly. Raw string concatenation is deliberately not a
 * fallback: if a checkpoint has no usable template, the candidate is not
 * comparable and the load should fail visibly.
 */
import type { GenerationMessage } from "../../core/ports/language-model.js";

export const OFFICIAL_CHAT_TEMPLATE = "tokenizer.apply_chat_template";

export interface ChatTemplateTokenizer {
  apply_chat_template(messages: GenerationMessage[], options: Record<string, unknown>): unknown;
}

export function applyOfficialChatTemplate(
  tokenizer: ChatTemplateTokenizer,
  messages: readonly GenerationMessage[]
): { prompt: string; strategy: typeof OFFICIAL_CHAT_TEMPLATE | "folded-system" } {
  if (messages.length === 0) throw new Error("a generation request needs at least one chat message");

  const apply = (input: readonly GenerationMessage[], options: Record<string, unknown>) => {
    const result = tokenizer.apply_chat_template([...input], {
      tokenize: false,
      add_generation_prompt: true,
      ...options,
    });
    if (typeof result !== "string") throw new Error("the checkpoint chat template did not return text");
    return result;
  };

  try {
    return { prompt: apply(messages, { enable_thinking: false }), strategy: OFFICIAL_CHAT_TEMPLATE };
  } catch (firstError) {
    const folded = messages.map((message) =>
      message.role === "system" ? { role: "user" as const, content: message.content } : message
    );

    try {
      return { prompt: apply(folded, {}), strategy: "folded-system" };
    } catch {
      throw firstError;
    }
  }
}
