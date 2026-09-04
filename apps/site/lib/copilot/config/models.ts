/**
 * Every model this site can run, named in one place.
 *
 * Sizes are approximate on purpose: the real number comes from the repository
 * manifest at download time, because a hardcoded byte count goes stale the
 * moment a repo is requantized and a wrong number is worse than none.
 */

import type { ModelCapabilityProfile } from "../core/entities/capability.js";

const MIB = 1024 * 1024;
const GIB = 1024 * MIB;

/** §41: capability tiers, so no use case names a concrete model. */
export type ModelTier = "light" | "balanced" | "strong";

export type GenerationProvider = "transformers-webgpu" | "chrome-language-model";
export type GenerationDType = "q4f16" | "q4" | "q8" | "fp16";
export type SamplingMode =
  | "most-predictable"
  | "predictable"
  | "slightly-predictable"
  | "balanced"
  | "slightly-creative"
  | "creative"
  | "most-creative";

/** One decoding recipe is part of a qualification, never an undocumented tweak. */
export interface DecodingSpec {
  id: string;
  label: string;
  source: "baseline" | "official-recommendation" | "runtime-default";
  temperature: number;
  topP?: number;
  topK?: number;
  presencePenalty?: number;
  repetitionPenalty?: number;
  thinking?: "disabled" | "enabled" | "unsupported";
  samplingMode?: SamplingMode;
  /** Explains an official control intentionally omitted by a runtime adapter. */
  compatibilityNote?: string;
}

/** Identity, runtime and measured capability deliberately have separate fields. */
export interface GenerationCandidate {
  id: string;
  provider: GenerationProvider;
  /** Repository/checkpoint for downloadable models; absent for Chrome's opaque model. */
  model?: string;
  modelFamily: string;
  modelRevision?: string;
  /** Exact parameter count only when the model/provider exposes it. */
  parameterCount?: number;
  dtype?: GenerationDType;
  label: string;
  summary: string;
  /** A hint for the UI only; measured download bytes belong in the run manifest. */
  approximateBytes?: number;
  contextWindow?: number;
  decodings: readonly DecodingSpec[];
  qualification: {
    status: "untested" | "failed" | "passed";
    benchmarkVersion: string;
  };
  capabilities?: ModelCapabilityProfile;
}

/** Product-facing downloadable model shape, kept as a compatibility alias for the picker. */
export interface GenerationModelSpec extends GenerationCandidate {
  provider: "transformers-webgpu";
  tier: ModelTier;
  repo: string;
  model: string;
  dtype: "q4f16" | "q4";
  approximateBytes: number;
  contextWindow: number;
}

export const QUALIFICATION_BENCHMARK_VERSION = "jit-copilot-p1-v1";

const DETERMINISTIC: DecodingSpec = {
  id: "deterministic",
  label: "deterministic / greedy",
  source: "baseline",
  temperature: 0,
  repetitionPenalty: 1.1,
  thinking: "disabled",
};

/** Qwen's model-card sampling recipe, limited to controls supported by our worker. */
const QWEN_RECOMMENDED: DecodingSpec = {
  id: "qwen-recommended",
  label: "Qwen recommended · Transformers.js-compatible",
  source: "official-recommendation",
  temperature: 1,
  topP: 1,
  topK: 20,
  repetitionPenalty: 1,
  thinking: "disabled",
  compatibilityNote:
    "Qwen's official presence_penalty=2 is omitted because the installed Transformers.js GenerationConfig does not expose presence_penalty.",
};

/** SmolLM2's model card uses conservative sampling for its Transformers example. */
const SMOL_RECOMMENDED: DecodingSpec = {
  id: "smollm-recommended",
  label: "SmolLM2 recommended sampling",
  source: "official-recommendation",
  temperature: 0.2,
  topP: 0.9,
  repetitionPenalty: 1.1,
  thinking: "unsupported",
};

function qualification(status: GenerationCandidate["qualification"]["status"] = "untested") {
  return { status, benchmarkVersion: QUALIFICATION_BENCHMARK_VERSION };
}

export const GENERATION_MODELS: GenerationModelSpec[] = [
  {
    id: "qwen3.5-0.8b",
    provider: "transformers-webgpu",
    model: "onnx-community/Qwen3.5-0.8B-Text-ONNX",
    modelFamily: "Qwen3.5",
    parameterCount: 800_000_000,
    tier: "light",
    repo: "onnx-community/Qwen3.5-0.8B-Text-ONNX",
    label: "Qwen3.5 0.8B",
    summary:
      "Smallest download. Explains covered questions from verified sources; falls back safely when evidence or generation is insufficient.",
    dtype: "q4f16",
    approximateBytes: 490 * MIB,
    contextWindow: 4096,
    decodings: [DETERMINISTIC, QWEN_RECOMMENDED],
    qualification: qualification("untested"),
  },
  {
    id: "qwen3-1.7b",
    provider: "transformers-webgpu",
    model: "onnx-community/Qwen3-1.7B-ONNX",
    modelFamily: "Qwen3",
    parameterCount: 1_700_000_000,
    tier: "balanced",
    repo: "onnx-community/Qwen3-1.7B-ONNX",
    label: "Qwen3 1.7B",
    summary: "Default beta model. Broader explanations, always checked against the documentation.",
    dtype: "q4f16",
    approximateBytes: GIB,
    contextWindow: 8192,
    decodings: [DETERMINISTIC],
    qualification: qualification("untested"),
  },
  {
    id: "gemma-4-e2b",
    provider: "transformers-webgpu",
    model: "onnx-community/gemma-4-E2B-it-ONNX",
    modelFamily: "Gemma 4 E2B",
    parameterCount: 2_000_000_000,
    tier: "strong",
    repo: "onnx-community/gemma-4-E2B-it-ONNX",
    label: "Gemma 4 E2B",
    summary: "Largest beta model. Best local generation tier, with the same evidence checks.",
    dtype: "q4f16",
    approximateBytes: 3 * GIB,
    contextWindow: 8192,
    decodings: [DETERMINISTIC],
    qualification: qualification("untested"),
  },
];

/** The deliberately small first qualification pool. No tier is inferred from size here. */
export const QUALIFICATION_CANDIDATES: readonly GenerationCandidate[] = [
  {
    id: "qwen3.5-0.8b-q4f16",
    provider: "transformers-webgpu",
    model: "onnx-community/Qwen3.5-0.8B-Text-ONNX",
    modelFamily: "Qwen3.5",
    parameterCount: 800_000_000,
    dtype: "q4f16",
    label: "Qwen3.5 0.8B · q4f16",
    summary: "Known browser baseline; qualifies this checkpoint and quantization only.",
    approximateBytes: 490 * MIB,
    contextWindow: 4096,
    decodings: [DETERMINISTIC, QWEN_RECOMMENDED],
    qualification: qualification("failed"),
  },
  {
    id: "smollm2-135m-instruct-q4f16",
    provider: "transformers-webgpu",
    model: "HuggingFaceTB/SmolLM2-135M-Instruct",
    modelFamily: "SmolLM2",
    parameterCount: 135_000_000,
    dtype: "q4f16",
    label: "SmolLM2 135M Instruct · q4f16",
    summary: "Experimental control for pleasant language versus grounded synthesis.",
    contextWindow: 8192,
    decodings: [DETERMINISTIC, SMOL_RECOMMENDED],
    qualification: qualification("untested"),
  },
  {
    id: "smollm2-360m-instruct-q4f16",
    provider: "transformers-webgpu",
    model: "HuggingFaceTB/SmolLM2-360M-Instruct",
    modelFamily: "SmolLM2",
    parameterCount: 360_000_000,
    dtype: "q4f16",
    label: "SmolLM2 360M Instruct · q4f16",
    summary: "Primary tiny downloadable candidate; capability is decided by Config P.",
    contextWindow: 8192,
    decodings: [DETERMINISTIC, SMOL_RECOMMENDED],
    qualification: qualification("untested"),
  },
  {
    id: "chrome-language-model",
    provider: "chrome-language-model",
    modelFamily: "Gemini Nano",
    label: "Chrome LanguageModel · Gemini Nano",
    summary: "Browser-provided local model; parameters, revision and download size are not exposed here.",
    decodings: [
      {
        id: "chrome-default",
        label: "Chrome default generation",
        source: "runtime-default",
        temperature: 0,
        thinking: "unsupported",
      },
    ],
    qualification: qualification("untested"),
  },
];

/**
 * The embedding model, and why it is not the old MiniLM.
 *
 * `all-MiniLM-L6-v2` is English-only. It was adequate while the ghost was
 * lexical-first and the docs were English, but §13 requires that "como validar
 * um uuid?" reaches "Validate a UUID string" — and MiniLM embeds the
 * Portuguese question somewhere unrelated to the English passage, so semantic
 * search actively hurt Portuguese questions. `multilingual-e5-small` shares
 * one space across both languages at the same 384 dimensions and a comparable
 * download.
 *
 * E5 models are trained with asymmetric prefixes: a query and a passage are
 * embedded differently, and skipping the prefixes costs a large chunk of the
 * retrieval quality. `pipelineVersion` exists so a change to those prefixes
 * invalidates every cached vector, because a mixed cache is silently wrong.
 */
export const EMBEDDING_MODEL = {
  id: "multilingual-e5-small",
  repo: "Xenova/multilingual-e5-small",
  label: "multilingual-e5-small",
  dtype: "q8" as const,
  dimensions: 384,
  approximateBytes: 118 * MIB,
  pipelineVersion: 1,
  queryPrefix: "query: ",
  passagePrefix: "passage: ",
};

export const DEFAULT_TIER: ModelTier = "balanced";

export function modelForTier(tier: ModelTier): GenerationModelSpec {
  const found = GENERATION_MODELS.find((model) => model.tier === tier);
  if (!found) throw new Error(`no model registered for tier ${tier}`);
  return found;
}

/** Browser cache bucket shared by every transformers.js download. */
export const MODEL_CACHE_KEY = "jit-copilot-models";
/** Remembers the chosen tier between visits. */
export const SELECTED_TIER_KEY = "jit.copilot.tier";
