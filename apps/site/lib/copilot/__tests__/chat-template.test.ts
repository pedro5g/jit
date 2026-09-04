import { describe, expect, it, vi } from "vitest";
import { applyOfficialChatTemplate, OFFICIAL_CHAT_TEMPLATE } from "../infrastructure/models/chat-template.js";

describe("checkpoint chat templates", () => {
  it("always uses tokenizer.apply_chat_template with thinking disabled first", () => {
    const apply = vi.fn(() => "<formatted>");
    const result = applyOfficialChatTemplate({ apply_chat_template: apply }, [
      { role: "system", content: "Use only evidence." },
      { role: "user", content: "Why is JIT fast?" },
    ]);

    expect(result).toEqual({ prompt: "<formatted>", strategy: OFFICIAL_CHAT_TEMPLATE });
    expect(apply).toHaveBeenCalledWith(
      [
        { role: "system", content: "Use only evidence." },
        { role: "user", content: "Why is JIT fast?" },
      ],
      { tokenize: false, add_generation_prompt: true, enable_thinking: false }
    );
  });

  it("folds a rejected system role only as a template compatibility fallback", () => {
    const apply = vi
      .fn()
      .mockImplementationOnce(() => {
        throw new Error("system role unsupported");
      })
      .mockReturnValueOnce("<folded>");

    const result = applyOfficialChatTemplate({ apply_chat_template: apply }, [
      { role: "system", content: "Use only evidence." },
      { role: "user", content: "Why is JIT fast?" },
    ]);

    expect(result).toEqual({ prompt: "<folded>", strategy: "folded-system" });
    expect(apply).toHaveBeenLastCalledWith(
      [
        { role: "user", content: "Use only evidence." },
        { role: "user", content: "Why is JIT fast?" },
      ],
      { tokenize: false, add_generation_prompt: true }
    );
  });
});
