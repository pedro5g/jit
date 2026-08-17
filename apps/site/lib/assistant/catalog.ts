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
 * Ordered lightest first, but the default is the second one.
 *
 * The 0.8B was the default for a while, on the reasoning that a reader who has
 * to wait for a gigabyte never gets a first answer. Measured against real
 * questions, it navigates correctly and then states things backwards, invents
 * API names, and — asked why jit is fast, with six correct sections in front
 * of it — writes "compila o código na memória da memória RAM" and an example
 * running a SQL query. Every audit and rewrite in this pipeline still could not
 * make it right, because the problem was never the evidence.
 *
 * So the download is twice the size and the answers are worth reading. The
 * 0.8B stays available for machines that cannot spare the memory, labelled for
 * what it is.
 */
export const GENERATION_MODELS: GenerationModel[] = [
  {
    id: "qwen3.5-0.8b",
    repo: "onnx-community/Qwen3.5-0.8B-Text-ONNX",
    label: "Qwen3.5 0.8B",
    summary:
      "Smallest download. Finds the right page, but gets the explanation wrong — a fallback for constrained machines.",
    dtype: "q4f16",
    family: "qwen",
    approximateBytes: 490 * MIB,
  },
  {
    id: "qwen3-1.7b",
    repo: "onnx-community/Qwen3-1.7B-ONNX",
    label: "Qwen3 1.7B",
    summary: "Default. The first size that explains correctly and answers API questions reliably.",
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

/**
 * The 1.7B, not the 0.8B above it. Correctness is the product here; the extra
 * half-gigabyte is what buys it, and it is downloaded once.
 */
export const DEFAULT_GENERATION_MODEL =
  GENERATION_MODELS.find((model) => model.id === "qwen3-1.7b") ?? GENERATION_MODELS[0];

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
