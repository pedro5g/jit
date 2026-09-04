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
import type { ContextService } from "../application/context/context.service.js";
import type { DecodingSpec, GenerationCandidate, GenerationModelSpec, ModelTier } from "../config/models.js";
import type { EmbeddingPort } from "../core/ports/embedding.js";
import type { LanguageModelPort } from "../core/ports/language-model.js";
import type { KnowledgeEngine } from "../infrastructure/knowledge-engine.js";
import {
  CONTEXT_VERSION,
  DATASET_VERSION,
  PROMPT_VERSION,
  type RunArtifacts,
  type RunManifest,
  runId,
} from "./artifacts.js";
import type { BrowserBlock } from "./browser-environment.js";
import {
  type CapabilityConfig,
  type CapabilityMeasuredCase,
  type CapabilityRunResult,
  capabilityManifest,
  capabilityProfile,
  runCapabilityBenchmark,
  summarizeCapability,
} from "./capability.js";
import type { MeasuredCase } from "./detectors.js";
import { generateCase, MAX_TOKENS, pipelinePrompt } from "./generation-run.js";
import type { EvalCase } from "./types.js";

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
  benchmarkKind?: RunManifest["benchmarkKind"];
  contextSource?: RunManifest["contextSource"];
  promptKind?: RunManifest["promptKind"];
  retry?: boolean;
  fallback?: boolean;
  citationsRequired?: boolean;
  config?: string;
  configLabel?: string;
  decoding?: DecodingSpec;
  runtime?: RunManifest["runtime"];
}

export function browserManifest(input: BrowserManifestInput): RunManifest {
  const config = input.config ?? browserConfigId(input.model.tier);
  const at = input.at ?? new Date();

  return {
    runId: runId(config, input.model.id, at),
    ranAt: at.toISOString(),
    model: {
      id: input.model.id,
      label: input.model.label,
      repo: input.model.model,
      family: input.model.modelFamily,
      ...(input.model.modelRevision ? { revision: input.model.modelRevision } : {}),
      ...(input.model.parameterCount !== undefined ? { parameterCount: input.model.parameterCount } : {}),
      dtype: input.model.dtype,
    },
    // Keep the legacy browser benchmark's provider label stable; the new
    // qualification manifest uses the explicit `transformers-webgpu` value.
    runtime: input.runtime ?? { provider: "transformers.js", device: "webgpu" },
    knowledge: {
      contentHash: input.knowledge.contentHash,
      embeddingModel: input.knowledge.embedding.model,
      chunks: input.knowledge.counts.chunks,
      symbols: input.knowledge.counts.symbols,
    },
    promptVersion: input.promptKind === "minimal-synthesis" ? 1 : PROMPT_VERSION,
    contextVersion: input.contextSource === "oracle" ? 1 : CONTEXT_VERSION,
    datasetVersion: DATASET_VERSION,
    generation: {
      maxTokens: input.maxTokens ?? MAX_TOKENS,
      temperature: input.decoding?.temperature ?? 0,
      greedy: (input.decoding?.temperature ?? 0) === 0,
      ...(input.decoding?.id ? { decodingId: input.decoding.id } : {}),
      ...(input.decoding?.source ? { decodingSource: input.decoding.source } : {}),
      ...(input.decoding?.topP !== undefined ? { topP: input.decoding.topP } : {}),
      ...(input.decoding?.topK !== undefined ? { topK: input.decoding.topK } : {}),
      ...(input.decoding?.presencePenalty !== undefined ? { presencePenalty: input.decoding.presencePenalty } : {}),
      ...(input.decoding?.repetitionPenalty !== undefined
        ? { repetitionPenalty: input.decoding.repetitionPenalty }
        : {}),
      maxTokensEnforced: true,
      chatTemplate: "tokenizer.apply_chat_template",
      ...(input.decoding?.thinking ? { thinking: input.decoding.thinking } : {}),
    },
    benchmarkKind: input.benchmarkKind ?? "production",
    contextSource: input.contextSource ?? "pipeline",
    promptKind: input.promptKind ?? "production",
    retry: input.retry ?? true,
    fallback: input.fallback ?? true,
    citationsRequired: input.citationsRequired ?? true,
    browser: input.browser,
    config,
    // The model is what varies inside the browser table; the runtime is in the
    // title. Leading with it keeps the column header readable when truncated.
    configLabel: input.configLabel ?? `${input.model.label} · WebGPU`,
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

export interface BrowserCapabilityRunInput {
  engine: KnowledgeEngine;
  contextService: ContextService;
  model: LanguageModelPort;
  embedder?: EmbeddingPort | null;
  spec: GenerationCandidate;
  decoding?: DecodingSpec;
  runtime?: RunManifest["runtime"];
  browser: BrowserBlock;
  config: CapabilityConfig;
  cases: readonly EvalCase[];
  onProgress?: (progress: { index: number; total: number; case: EvalCase; measured?: CapabilityMeasuredCase }) => void;
  onDelta?: (delta: string) => void;
  signal?: AbortSignal;
}

/** Browser adapter for P/R/X; it shares all experiment logic with tests. */
export function runBrowserCapabilityBenchmark(input: BrowserCapabilityRunInput): Promise<CapabilityRunResult> {
  return runCapabilityBenchmark({ ...input, decoding: input.decoding, runtime: input.runtime });
}

/** Records a provider/runtime availability result without calling the model. */
export function unavailableCapabilityRun(input: {
  engine: KnowledgeEngine;
  spec: GenerationCandidate;
  browser: BrowserBlock;
  config: CapabilityConfig;
  availability: RunManifest["runtime"]["availability"];
  detail: string;
}): CapabilityRunResult {
  const artifacts: RunArtifacts = {
    manifest: capabilityManifest({
      config: input.config,
      model: input.spec,
      browser: input.browser,
      knowledge: input.engine.manifest,
      cases: 0,
      runtime: {
        provider: input.spec.provider,
        device: input.spec.provider === "chrome-language-model" ? "browser" : "webgpu",
        availability: input.availability,
        compatibility: "unavailable",
        availabilityDetail: input.detail,
      },
    }),
    cases: [],
    contexts: [],
    responses: [],
  };
  const metrics = summarizeCapability([]);
  return { artifacts, measured: [], metrics, deliveredMetrics: metrics, profile: capabilityProfile([]) };
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
