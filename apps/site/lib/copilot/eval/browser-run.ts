/**
 * The benchmark, run in the runtime a reader is actually in — §PART 26.
 *
 * The headless A/B/C run answered how much came from the knowledge engine and
 * how much a larger model adds. It could not answer the question the product
 * turns on, because the model the light tier ships — Qwen3.5-0.8B — does not
 * load under `onnxruntime-node` at all. So the browser is not a convenience
 * here; it is the only place that number exists.
 *
 * Everything that decides a number is imported rather than reimplemented: the
 * case set, the context service, the prompt, the detectors. What this file
 * adds is the two things a browser run genuinely has and a headless one does
 * not — a machine worth recording, and a run that must survive being closed
 * halfway through.
 */
import type { ContextService } from "../application/context/context.service";
import type { GenerationModelSpec, ModelTier } from "../config/models";
import type { EmbeddingPort } from "../core/ports/embedding";
import type { LanguageModelPort } from "../core/ports/language-model";
import type { KnowledgeEngine } from "../infrastructure/knowledge-engine";
import {
  CONTEXT_VERSION,
  DATASET_VERSION,
  PROMPT_VERSION,
  type RunArtifacts,
  type RunManifest,
  runId,
} from "./artifacts";
import type { BrowserBlock } from "./browser-environment";
import type { MeasuredCase } from "./detectors";
import { generateCase, MAX_TOKENS, pipelinePrompt } from "./generation-run";
import type { EvalCase } from "./types";

/**
 * A browser run's configuration is its tier, not another letter.
 *
 * `A`, `B` and `C` are the headless comparison's, and reusing one would put a
 * WebGPU run in the headless table the moment `knowledge:rescore` picked the
 * latest run per configuration. The tier name also says what the row is
 * without a legend, which a fourth letter would not.
 */
export function browserConfigId(tier: ModelTier): string {
  return tier;
}

export interface BrowserManifestInput {
  model: GenerationModelSpec;
  browser: BrowserBlock;
  knowledge: KnowledgeEngine["manifest"];
  cases: number;
  maxTokens?: number;
  at?: Date;
}

export function browserManifest(input: BrowserManifestInput): RunManifest {
  const config = browserConfigId(input.model.tier);
  const at = input.at ?? new Date();

  return {
    runId: runId(config, input.model.id, at),
    ranAt: at.toISOString(),
    model: {
      id: input.model.id,
      label: input.model.label,
      repo: input.model.repo,
      dtype: input.model.dtype,
    },
    runtime: { provider: "transformers.js", device: "webgpu" },
    knowledge: {
      contentHash: input.knowledge.contentHash,
      embeddingModel: input.knowledge.embedding.model,
      chunks: input.knowledge.counts.chunks,
      symbols: input.knowledge.counts.symbols,
    },
    promptVersion: PROMPT_VERSION,
    contextVersion: CONTEXT_VERSION,
    datasetVersion: DATASET_VERSION,
    generation: { maxTokens: input.maxTokens ?? MAX_TOKENS, temperature: 0, greedy: true },
    browser: input.browser,
    config,
    // The model is what varies inside the browser table; the runtime is in the
    // title. Leading with it keeps the column header readable when truncated.
    configLabel: `${input.model.label} · WebGPU`,
    cases: input.cases,
  };
}

export interface BrowserRunProgress {
  index: number;
  total: number;
  case: EvalCase;
  /** Present once the case has finished. */
  measured?: MeasuredCase;
}

export interface BrowserRunInput {
  engine: KnowledgeEngine;
  contextService: ContextService;
  model: LanguageModelPort;
  embedder?: EmbeddingPort | null;
  spec: GenerationModelSpec;
  browser: BrowserBlock;
  cases: readonly EvalCase[];
  onProgress?: (progress: BrowserRunProgress) => void;
  onDelta?: (delta: string) => void;
  signal?: AbortSignal;
}

export interface BrowserRunResult {
  artifacts: RunArtifacts;
  measured: MeasuredCase[];
}

/**
 * Walks the case set once, and keeps what it has after every case.
 *
 * A stop halfway through leaves a shorter run, not a lost one: the manifest is
 * written from what completed, so its `cases` count and the three streams
 * agree by construction — which is the invariant `parseBundle` refuses to
 * import without.
 */
export async function runBrowserBenchmark(input: BrowserRunInput): Promise<BrowserRunResult> {
  const prompt = pipelinePrompt(input.engine, input.contextService, input.embedder ?? null);
  const result: BrowserRunResult = {
    artifacts: {
      manifest: browserManifest({
        model: input.spec,
        browser: input.browser,
        knowledge: input.engine.manifest,
        cases: 0,
      }),
      cases: [],
      contexts: [],
      responses: [],
    },
    measured: [],
  };

  for (const [index, testCase] of input.cases.entries()) {
    if (input.signal?.aborted) break;
    input.onProgress?.({ index, total: input.cases.length, case: testCase });

    const { measured, records } = await generateCase({
      engine: input.engine,
      model: input.model,
      prompt,
      case: testCase,
      ...(input.onDelta ? { onDelta: input.onDelta } : {}),
      ...(input.signal ? { signal: input.signal } : {}),
    });

    result.measured.push(measured);
    result.artifacts.cases.push(records.case);
    result.artifacts.contexts.push(records.context);
    result.artifacts.responses.push(records.response);
    result.artifacts.manifest.cases = result.artifacts.responses.length;

    input.onProgress?.({ index, total: input.cases.length, case: testCase, measured });
  }

  return result;
}
