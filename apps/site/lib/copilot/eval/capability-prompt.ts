/** The benchmark prompt, intentionally separate from the production prompt. */
import type { ModelContext } from "../core/entities/model-context.js";
import type { GenerationMessage } from "../core/ports/language-model.js";
import type { OracleContext } from "./oracle-context.js";

export const CAPABILITY_PROMPT_VERSION = 1;

const MINIMAL_SYNTHESIS_INSTRUCTIONS = [
  "You are explaining the JIT library.",
  "Use only the verified facts supplied below.",
  "Connect facts only when the relationship is directly supported by the evidence.",
  "Answer naturally and thoroughly in the user's language.",
  "For broad questions, explain the causal mechanism rather than listing facts. Prefer cause, mechanism, consequence.",
  "Answer with explanatory prose only; do not include source markers, route ids, or navigation syntax.",
  "Do not mention that you were given documentation.",
].join("\n");

export function minimalSynthesisMessages(input: OracleContext | ModelContext): GenerationMessage[] {
  const evidence = input.evidence.map((item, index) => `EVIDENCE ${index + 1}\n${item.content}`).join("\n\n");

  return [
    { role: "system", content: MINIMAL_SYNTHESIS_INSTRUCTIONS },
    {
      role: "user",
      content: [`QUESTION: ${input.question}`, "", "VERIFIED EVIDENCE:", evidence].join("\n"),
    },
  ];
}

export function hasProductionProtocolPrompt(messages: readonly GenerationMessage[]): boolean {
  const text = messages.map((message) => message.content).join("\n");
  return /ANSWER_RULES|TOOL_RULES|ACTION_RULES|\[\[go:|cite at least|citation required/i.test(text);
}
