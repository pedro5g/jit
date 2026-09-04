import { describe, expect, it } from "vitest";
import { QUALIFICATION_BENCHMARK_VERSION, QUALIFICATION_CANDIDATES } from "../config/models.js";

describe("qualification candidate registry", () => {
  it("keeps identity, runtime and qualification metadata separate", () => {
    expect(QUALIFICATION_CANDIDATES.map((candidate) => candidate.id)).toEqual([
      "qwen3.5-0.8b-q4f16",
      "smollm2-135m-instruct-q4f16",
      "smollm2-360m-instruct-q4f16",
      "chrome-language-model",
    ]);
    expect(
      QUALIFICATION_CANDIDATES.every(
        (candidate) => candidate.qualification.benchmarkVersion === QUALIFICATION_BENCHMARK_VERSION
      )
    ).toBe(true);
    expect(QUALIFICATION_CANDIDATES.every((candidate) => "provider" in candidate && "modelFamily" in candidate)).toBe(
      true
    );
  });

  it("does not invent opaque Chrome model parameters or download size", () => {
    const chrome = QUALIFICATION_CANDIDATES.find((candidate) => candidate.provider === "chrome-language-model");
    expect(chrome).toMatchObject({ modelFamily: "Gemini Nano", provider: "chrome-language-model" });
    expect(chrome?.parameterCount).toBeUndefined();
    expect(chrome?.model).toBeUndefined();
    expect(chrome?.dtype).toBeUndefined();
    expect(chrome?.approximateBytes).toBeUndefined();
  });

  it("registers only deterministic plus officially documented alternate recipes", () => {
    for (const candidate of QUALIFICATION_CANDIDATES.slice(0, 3)) {
      expect(candidate.decodings.map((decoding) => decoding.source)).toEqual(["baseline", "official-recommendation"]);
    }
    expect(QUALIFICATION_CANDIDATES[3]?.decodings[0]?.source).toBe("runtime-default");
  });

  it("records when the Qwen recipe is a Transformers.js-compatible subset", () => {
    const qwen = QUALIFICATION_CANDIDATES[0];
    const recommended = qwen?.decodings.find((decoding) => decoding.id === "qwen-recommended");
    expect(recommended).toMatchObject({ temperature: 1, topP: 1, topK: 20, repetitionPenalty: 1 });
    expect(recommended?.presencePenalty).toBeUndefined();
    expect(recommended?.compatibilityNote).toContain("presence_penalty");
  });
});
