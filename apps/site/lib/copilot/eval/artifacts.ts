/**
 * Benchmark runs, on disk, versioned — §PART 8.
 *
 * A transcript without a manifest is an anecdote. Six weeks later nobody can
 * say whether an answer came from a different model, a different knowledge
 * build, a different prompt or a different scorer, and the comparison that
 * seemed to show an improvement is unfalsifiable.
 *
 * So every run records what produced it, and the three streams are kept apart:
 * the cases asked, the contexts built, the responses generated. Separating
 * them is what makes re-scoring cheap — a new detector reads `responses.jsonl`
 * and `contexts.jsonl` and never regenerates a token.
 */
import type { ModelContext } from "../core/entities/model-context";
import type { EvalCase } from "./types";

/** Bumped when the prompt's wording changes in a way that could move results. */
export const PROMPT_VERSION = 2;
/** Bumped when context selection changes: roles, quotas, budget, dedupe. */
export const CONTEXT_VERSION = 2;
/** Bumped when the case set changes. */
export const DATASET_VERSION = 1;

export interface RunManifest {
  runId: string;
  ranAt: string;

  model: { id: string; label: string; repo: string; dtype: string; revision?: string };
  /** `node` is absent for a browser run, where there is none to record. */
  runtime: { provider: string; device: string; node?: string };

  /** What the model was answering from. */
  knowledge: { contentHash: string; embeddingModel: string; chunks: number; symbols: number };

  promptVersion: number;
  contextVersion: number;
  datasetVersion: number;

  generation: { maxTokens: number; temperature: number; greedy: boolean };

  /**
   * Where a browser run differs from a headless one — §PART 27.
   *
   * Absent for a headless run, and every field inside it optional, because the
   * platform does not expose these reliably: `deviceMemory` and
   * `performance.memory` are Chrome-only, and an adapter's vendor and
   * architecture are empty strings on some builds. A missing field is recorded
   * as missing rather than guessed.
   */
  browser?: {
    userAgent: string;
    adapter?: { vendor?: string; architecture?: string; description?: string };
    deviceClass?: { cores?: number; memoryGb?: number };
    peakMemoryMb?: number;
  };

  /** `A`, `B`, `C` headless; a browser run's is its tier — never a letter. */
  config: string;
  /** What that configuration was, spelled out for a report's column header. */
  configLabel: string;
  cases: number;
}

/** One line of `cases.jsonl`. */
export interface CaseRecord {
  question: string;
  category: string;
  locale: string;
  expected: EvalCase["expected"];
}

/**
 * One line of `contexts.jsonl` — §PART 10.
 *
 * The evidence, not just its ids: a re-score run six weeks later has to be
 * able to check a claim against the passage the model actually saw, and the
 * knowledge build it came from may no longer exist.
 */
export interface ContextRecord {
  question: string;
  knowledgeIds: string[];
  chunkIds: string[];
  symbolIds: string[];
  routeIds: string[];
  retrievalReasons: string[];
  contextTokens: number;
  /** The serialized `ModelContext`, so a scorer needs nothing else. */
  context: ModelContext;
}

/** One line of `responses.jsonl`. */
export interface ResponseRecord {
  question: string;
  answer: string;
  latencyMs: number;
  tokensPerSecond: number;
  /** Time to first token, which only a streaming host can measure — §PART 27. */
  ttftMs?: number;
  promptTokens?: number;
  completionTokens?: number;
}

export interface RunArtifacts {
  manifest: RunManifest;
  cases: CaseRecord[];
  contexts: ContextRecord[];
  responses: ResponseRecord[];
}

export function toJsonl(rows: readonly unknown[]): string {
  return `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`;
}

export function fromJsonl<T>(text: string): T[] {
  return text
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line) as T);
}

/**
 * A run id that sorts chronologically and says what it is at a glance.
 *
 * `2026-08-30T2118-B-qwen2.5-0.5b`. Timestamps alone make a directory listing
 * useless; a hash alone makes it unreadable.
 */
export function runId(config: string, modelId: string, at = new Date()): string {
  const stamp = at
    .toISOString()
    .replace(/:\d\d\.\d+Z$/, "")
    .replace(/[:]/g, "");
  return `${stamp}-${config}-${modelId}`;
}
