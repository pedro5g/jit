/**
 * Every model this site can run, named in one place. Nothing here reaches the
 * network until a reader explicitly asks for a local model.
 *
 * Sizes are not written down: they are read from the repository manifest at
 * download time, because a hardcoded number goes stale the moment a repo is
 * requantized and a wrong number is worse than no number.
 */

export type ModelFamily = "qwen" | "gemma";

export interface GenerationModel {
  id: string;
  repo: string;
  label: string;
  /** One-line tradeoff, shown in the picker. */
  summary: string;
  dtype: "q4f16" | "q4";
  family: ModelFamily;
  /** Roughly what to expect before the manifest is fetched. */
  approximateBytes: number;
}

const GIB = 1024 * 1024 * 1024;
const MIB = 1024 * 1024;

/**
 * Ordered lightest first. The default is the smallest model that can follow
 * "answer from these sections and emit an action tag", because a reader who
 * has to wait for three gigabytes before their first answer never gets one.
 *
 * It is the floor, not a recommendation: measured against real questions it
 * navigates correctly and still states things backwards and invents API names,
 * which is why answers are verified against the real surface before they are
 * shown. Readers who want the answers themselves to be right should move up
 * one size.
 */
export const GENERATION_MODELS: GenerationModel[] = [
  {
    id: "qwen3.5-0.8b",
    repo: "onnx-community/Qwen3.5-0.8B-Text-ONNX",
    label: "Qwen3.5 0.8B",
    summary: "Runs anywhere with WebGPU. Navigates well, but gets details wrong — expect invented names.",
    dtype: "q4f16",
    family: "qwen",
    approximateBytes: 490 * MIB,
  },
  {
    id: "qwen3-1.7b",
    repo: "onnx-community/Qwen3-1.7B-ONNX",
    label: "Qwen3 1.7B",
    summary: "Recommended. Twice the download, and the first size that answers API questions reliably.",
    dtype: "q4f16",
    family: "qwen",
    approximateBytes: GIB,
  },
  {
    id: "gemma-4-e2b",
    repo: "onnx-community/gemma-4-E2B-it-ONNX",
    label: "Gemma 4 E2B",
    summary: "The strongest answers here, and by far the largest download. For a dedicated GPU.",
    dtype: "q4f16",
    family: "gemma",
    approximateBytes: 3 * GIB,
  },
];

export const DEFAULT_GENERATION_MODEL = GENERATION_MODELS[0];

export function findGenerationModel(id: string | null | undefined): GenerationModel {
  return GENERATION_MODELS.find((model) => model.id === id) ?? DEFAULT_GENERATION_MODEL;
}

export const EMBEDDING_MODEL = {
  id: "minilm",
  repo: "Xenova/all-MiniLM-L6-v2",
  label: "all-MiniLM-L6-v2",
  dtype: "q8" as const,
  approximateBytes: 23 * MIB,
};

/** Chrome's built-in Prompt API — no download this site controls. */
export const CHROME_BUILT_IN_LABEL = "Chrome built-in";

/** Browser cache bucket shared by every transformers.js download. */
export const TRANSFORMERS_CACHE_KEY = "jit-assistant-models";

/** Remembers the chosen model between visits. */
export const SELECTED_MODEL_KEY = "jit.assistant.model";

/** Where the build-time retrieval index is served from. */
export const DOCS_INDEX_URL = "/assistant/docs-index.json";

/**
 * The library's real three-level surface, reflected from the runtime at build
 * time. Loaded next to the docs index and never separately: an audit that
 * cannot name what exists is an audit that passes everything.
 */
export const API_SURFACE_URL = "/assistant/api-surface.json";
