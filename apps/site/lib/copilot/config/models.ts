/**
 * Every model this site can run, named in one place.
 *
 * Sizes are approximate on purpose: the real number comes from the repository
 * manifest at download time, because a hardcoded byte count goes stale the
 * moment a repo is requantized and a wrong number is worse than none.
 */

const MIB = 1024 * 1024;
const GIB = 1024 * MIB;

/** §41: capability tiers, so no use case names a concrete model. */
export type ModelTier = "light" | "balanced" | "strong";

export interface GenerationModelSpec {
  id: string;
  tier: ModelTier;
  repo: string;
  label: string;
  summary: string;
  dtype: "q4f16" | "q4";
  approximateBytes: number;
  /** What the router will not ask this tier to do. */
  contextWindow: number;
}

export const GENERATION_MODELS: GenerationModelSpec[] = [
  {
    id: "qwen3.5-0.8b",
    tier: "light",
    repo: "onnx-community/Qwen3.5-0.8B-Text-ONNX",
    label: "Qwen3.5 0.8B",
    summary: "Smallest download. Navigation, API lookup and short explanations.",
    dtype: "q4f16",
    approximateBytes: 490 * MIB,
    contextWindow: 4096,
  },
  {
    id: "qwen3-1.7b",
    tier: "balanced",
    repo: "onnx-community/Qwen3-1.7B-ONNX",
    label: "Qwen3 1.7B",
    summary: "Default. Explains correctly and answers API questions reliably.",
    dtype: "q4f16",
    approximateBytes: GIB,
    contextWindow: 8192,
  },
  {
    id: "gemma-4-e2b",
    tier: "strong",
    repo: "onnx-community/gemma-4-E2B-it-ONNX",
    label: "Gemma 4 E2B",
    summary: "The strongest answers here, and by far the largest download.",
    dtype: "q4f16",
    approximateBytes: 3 * GIB,
    contextWindow: 8192,
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
