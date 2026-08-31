import type { GenerationMessage } from "../../core/ports/language-model";

export interface HistoryTurn extends GenerationMessage {
  /** A safe fallback was shown; the hidden model prose must not become context. */
  rejected?: boolean;
}

/**
 * Builds conversational context without teaching the next turn from an answer
 * the audit already rejected. Its paired user message is removed as well so a
 * dangling question cannot look like an unanswered instruction to the model.
 */
export function acceptedHistory(messages: readonly HistoryTurn[], limit = 6): GenerationMessage[] {
  const accepted: GenerationMessage[] = [];

  for (const message of messages) {
    if (message.role === "assistant" && message.rejected) {
      if (accepted.at(-1)?.role === "user") accepted.pop();
      continue;
    }

    accepted.push({ role: message.role, content: message.content });
  }

  return accepted.slice(-limit);
}
