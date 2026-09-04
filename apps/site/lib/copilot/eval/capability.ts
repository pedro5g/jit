/**
 * The controlled P/R/X generation experiment.
 *
 * P and R share one raw-only generation path. X delegates to the existing
 * production generator unchanged. The distinction is intentionally visible
 * in the types: a detector may observe every result, but only X may perform
 * retry, salvage or grounded delivery.
 */

import { StrictAuditPolicy } from "../application/audit/audit.service.js";
import type { ContextService } from "../application/context/context.service.js";
import { estimateTokens } from "../application/context/token-budget.js";
import { queryConcepts, tokenize } from "../application/retrieval/tokenizer.js";
import type { DecodingSpec, GenerationCandidate } from "../config/models.js";
import type { ModelCapabilityLevel, ModelCapabilityProfile } from "../core/entities/capability.js";
import type { ModelContext } from "../core/entities/model-context.js";
import type { GenerationMessage, LanguageModelPort } from "../core/ports/language-model.js";
import type { Locale } from "../core/value-objects/locale.js";
import type { KnowledgeEngine } from "../infrastructure/knowledge-engine.js";
import {
  type CaseRecord,
  CONTEXT_VERSION,
  type ContextRecord,
  DATASET_VERSION,
  PROMPT_VERSION,
  type ResponseRecord,
  type RunArtifacts,
  type RunManifest,
  runId,
} from "./artifacts.js";
import type { BrowserBlock } from "./browser-environment.js";
import { minimalSynthesisMessages } from "./capability-prompt.js";
import { type MeasuredCase, measureAnswer, measureGeneration } from "./detectors.js";
import { explanationCases, resolveExplanationFacets } from "./explanation-cases.js";
import { generateCase, MAX_TOKENS, pipelinePrompt } from "./generation-run.js";
import { type OracleContext, OracleContextBuilder, type OracleFacetPriority } from "./oracle-context.js";
import type { EvalCase } from "./types.js";

export type CapabilityConfig = "P" | "R" | "X";
export type CapabilityDiagnosis = "model-capability" | "context-loss" | "protocol-overload" | "production-success";

export const CAPABILITY_CASE_COUNT = 8;
export const CAPABILITY_FACET_WEIGHTS: Record<OracleFacetPriority, number> = {
  core: 3,
  supporting: 2,
  optional: 1,
};

/** Fixed before generation and shared by the smoke and full browser runs. */
const SMOKE_QUESTIONS = new Set([
  "por que a JIT é tão rápida?",
  "why is jit fast?",
  "como a JIT funciona?",
  "how does jit work?",
  "qual a diferença entre runtime e AOT?",
  "what is the difference between runtime and AOT?",
  "como a validation funciona?",
  "how does validation work?",
]);

const HUMAN_REVIEW_QUESTIONS = [
  "por que a JIT é tão rápida?",
  "como a JIT funciona?",
  "qual a diferença entre runtime e AOT?",
  "como a validation funciona?",
  "como a JIT reduz alocações no hot path?",
  "why is jit fast?",
  "how does jit work?",
  "what is the difference between runtime and AOT?",
  "how does validation work?",
  "how do queries work?",
];

export function capabilityCases(kind: "smoke" | "full" = "full"): EvalCase[] {
  const cases = explanationCases();
  return kind === "full" ? cases : cases.filter((testCase) => SMOKE_QUESTIONS.has(testCase.question));
}

export function humanReviewCases(cases: readonly EvalCase[]): EvalCase[] {
  const byQuestion = new Map(cases.map((testCase) => [testCase.question, testCase]));
  return HUMAN_REVIEW_QUESTIONS.map((question) => byQuestion.get(question)).filter(
    (testCase): testCase is EvalCase => testCase !== undefined
  );
}

export interface CapabilityCaseMeasurement {
  weightedFacetCoverage: number;
  weightedExplanationCompleteness: number;
  rawFacetCoverage: number;
  coreFacetCoverage: number;
  supportingFacetCoverage: number;
  optionalFacetCoverage: number;
  causalCoherence: number;
  usableExplanation: boolean;
}

export interface CapabilityMeasuredCase extends MeasuredCase {
  /** Exact model text before any X delivery processing. */
  rawAnswer: string;
  /** Text finally delivered; equal to rawAnswer for P and R. */
  deliveredAnswer: string;
  capability: CapabilityCaseMeasurement;
  promptTokens?: number;
  completionTokens?: number;
  promptTokensEstimated?: boolean;
  deliveredMeasurement?: MeasuredCase["measurement"];
  deliveredCapability?: CapabilityCaseMeasurement;
}

export interface CapabilityRuntimeMetrics {
  medianLatencyMs: number;
  p95LatencyMs: number;
  medianTtftMs: number | null;
  tokensPerSecond: number | null;
  promptTokens: number | null;
  completionTokens: number | null;
  promptTokensEstimated: boolean;
}

export interface CapabilityMetrics {
  generation: ReturnType<typeof measureGeneration>;
  weightedExplanationCompleteness: number;
  rawFacetCoverage: number;
  coreFacetCoverage: number;
  supportingFacetCoverage: number;
  optionalFacetCoverage: number;
  causalCoherence: number;
  usableExplanation: number;
  runtime: CapabilityRuntimeMetrics;
}

export interface CapabilityRunResult {
  artifacts: RunArtifacts;
  measured: CapabilityMeasuredCase[];
  metrics: CapabilityMetrics;
  deliveredMetrics: CapabilityMetrics;
  profile: ModelCapabilityProfile;
}

export interface CapabilityRescoreInput {
  engine: KnowledgeEngine;
  manifest: RunManifest;
  cases: readonly CaseRecord[];
  contexts: readonly ContextRecord[];
  responses: readonly ResponseRecord[];
}

/** Re-score saved P/R/X transcripts without loading or calling a model. */
export function rescoreCapabilityRun(input: CapabilityRescoreInput): CapabilityRunResult {
  const contextByQuestion = new Map(input.contexts.map((record) => [record.question, record]));
  const responseByQuestion = new Map(input.responses.map((record) => [record.question, record]));
  const builder = new OracleContextBuilder({
    knowledge: input.engine.knowledge,
    graph: input.engine.graph,
    chunks: input.engine.chunks,
  });
  const measured: CapabilityMeasuredCase[] = [];

  for (const record of input.cases) {
    const contextRecord = contextByQuestion.get(record.question);
    const response = responseByQuestion.get(record.question);
    if (!contextRecord || !response) continue;
    const testCase = { ...record, locale: record.locale as Locale } as EvalCase;
    const oracle = contextRecord.oracle ?? builder.build({ case: testCase });
    const rawAnswer = response.rawAnswer ?? response.answer;
    const rawMeasurement = measureAnswer({
      answer: rawAnswer,
      case: testCase,
      context: contextRecord.context,
      symbols: input.engine.symbols,
      knowledge: input.engine.knowledge,
      corpusKnows: (term) => input.engine.lexical.knows(term),
    });
    const deliveredMeasurement = measureAnswer({
      answer: response.answer,
      case: testCase,
      context: contextRecord.context,
      symbols: input.engine.symbols,
      knowledge: input.engine.knowledge,
      corpusKnows: (term) => input.engine.lexical.knows(term),
      sourceOnly: response.delivery === "grounded-synthesis",
    });
    measured.push(
      makeMeasuredCase({
        testCase,
        oracle,
        rawAnswer,
        deliveredAnswer: response.answer,
        rawMeasurement,
        deliveredMeasurement,
        latencyMs: response.latencyMs,
        tokensPerSecond: response.tokensPerSecond,
        ttftMs: response.ttftMs,
        promptTokens: response.promptTokens,
        completionTokens: response.completionTokens,
        promptTokensEstimated: response.promptTokensEstimated,
        finish: response.finish,
        truncated: response.truncated,
        delivery: response.delivery ?? "model",
      })
    );
  }

  return {
    artifacts: {
      manifest: input.manifest,
      cases: [...input.cases],
      contexts: [...input.contexts],
      responses: [...input.responses],
    },
    measured,
    metrics: summarizeCapability(measured),
    profile: capabilityProfile(measured),
    deliveredMetrics: summarizeCapability(
      measured.map((row) => ({
        ...row,
        measurement: row.deliveredMeasurement ?? row.measurement,
        capability: row.deliveredCapability ?? row.capability,
      }))
    ),
  };
}

export interface CapabilityManifestInput {
  config: CapabilityConfig;
  model: GenerationCandidate;
  browser: BrowserBlock;
  knowledge: KnowledgeEngine["manifest"];
  cases: number;
  decoding?: DecodingSpec;
  runtime?: RunManifest["runtime"];
  at?: Date;
}

export function capabilityManifest(input: CapabilityManifestInput): RunManifest {
  const at = input.at ?? new Date();
  const production = input.config === "X";
  const decoding = input.decoding ?? input.model.decodings[0];
  const runtime = input.runtime ?? {
    provider: input.model.provider,
    device: input.model.provider === "chrome-language-model" ? "browser" : "webgpu",
  };
  return {
    runId: runId(input.config, input.model.id, at),
    ranAt: at.toISOString(),
    model: {
      id: input.model.id,
      label: input.model.label,
      ...(input.model.model ? { repo: input.model.model } : {}),
      ...(input.model.modelFamily ? { family: input.model.modelFamily } : {}),
      ...(input.model.dtype ? { dtype: input.model.dtype } : {}),
      ...(input.model.modelRevision ? { revision: input.model.modelRevision } : {}),
      ...(input.model.parameterCount !== undefined ? { parameterCount: input.model.parameterCount } : {}),
    },
    runtime,
    knowledge: {
      contentHash: input.knowledge.contentHash,
      embeddingModel: input.knowledge.embedding.model,
      chunks: input.knowledge.counts.chunks,
      symbols: input.knowledge.counts.symbols,
    },
    promptVersion: production ? PROMPT_VERSION : 1,
    contextVersion: production ? CONTEXT_VERSION : 1,
    datasetVersion: DATASET_VERSION,
    generation: {
      maxTokens: MAX_TOKENS,
      temperature: decoding?.temperature ?? 0,
      greedy: (decoding?.temperature ?? 0) === 0,
      ...(decoding?.id ? { decodingId: decoding.id } : {}),
      ...(decoding?.source ? { decodingSource: decoding.source } : {}),
      ...(decoding?.topP !== undefined ? { topP: decoding.topP } : {}),
      ...(decoding?.topK !== undefined ? { topK: decoding.topK } : {}),
      ...(decoding?.presencePenalty !== undefined ? { presencePenalty: decoding.presencePenalty } : {}),
      ...(decoding?.repetitionPenalty !== undefined ? { repetitionPenalty: decoding.repetitionPenalty } : {}),
      ...(decoding?.compatibilityNote ? { decodingNote: decoding.compatibilityNote } : {}),
      maxTokensEnforced: input.model.provider !== "chrome-language-model",
      ...(input.model.provider === "transformers-webgpu" ? { chatTemplate: "tokenizer.apply_chat_template" } : {}),
      ...(decoding?.samplingMode ? { samplingMode: decoding.samplingMode } : {}),
      ...(decoding?.thinking ? { thinking: decoding.thinking } : {}),
    },
    benchmarkKind: production ? "production" : input.config === "R" ? "real-context" : "capability",
    contextSource: input.config === "P" ? "oracle" : "pipeline",
    promptKind: production ? "production" : "minimal-synthesis",
    retry: production,
    fallback: production,
    citationsRequired: production,
    browser: input.browser,
    config: input.config,
    configLabel: `${input.config} · ${input.model.label} · ${runtime.provider}`,
    cases: input.cases,
  };
}

export interface CapabilityRunInput {
  engine: KnowledgeEngine;
  contextService: ContextService;
  model: LanguageModelPort;
  embedder?: import("../core/ports/embedding").EmbeddingPort | null;
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

export async function runCapabilityBenchmark(input: CapabilityRunInput): Promise<CapabilityRunResult> {
  const cases = resolveExplanationFacets(input.cases, input.engine.knowledge, input.engine.graph);
  const oracleBuilder = new OracleContextBuilder({
    knowledge: input.engine.knowledge,
    graph: input.engine.graph,
    chunks: input.engine.chunks,
  });
  const productionPrompt = pipelinePrompt(input.engine, input.contextService, input.embedder ?? null);
  const artifacts: RunArtifacts = {
    manifest: capabilityManifest({
      config: input.config,
      model: input.spec,
      browser: input.browser,
      knowledge: input.engine.manifest,
      cases: 0,
      decoding: input.decoding,
      runtime: input.runtime,
    }),
    cases: [],
    contexts: [],
    responses: [],
  };
  const measured: CapabilityMeasuredCase[] = [];

  for (const [index, testCase] of cases.entries()) {
    if (input.signal?.aborted) break;
    input.onProgress?.({ index, total: cases.length, case: testCase });

    const oracle = oracleBuilder.build({ case: testCase });
    let row: CapabilityMeasuredCase;

    if (input.config === "X") {
      const generated = await generateCase({
        engine: input.engine,
        model: input.model,
        prompt: productionPrompt,
        case: testCase,
        ...(input.onDelta ? { onDelta: input.onDelta } : {}),
        ...(input.signal ? { signal: input.signal } : {}),
        ...(input.decoding ? { decoding: input.decoding } : {}),
      });
      const delivered = generated.measured.measurement;
      const raw = generated.measured.rawMeasurement ?? delivered;
      const rawAnswer = generated.records.response.rawAnswer ?? generated.records.response.answer;
      row = makeMeasuredCase({
        testCase,
        oracle,
        rawAnswer,
        deliveredAnswer: generated.records.response.answer,
        rawMeasurement: raw,
        deliveredMeasurement: delivered,
        latencyMs: generated.measured.latencyMs,
        tokensPerSecond: generated.measured.tokensPerSecond,
        ttftMs: generated.measured.ttftMs,
        promptTokens: generated.records.response.promptTokens,
        completionTokens: generated.records.response.completionTokens,
        promptTokensEstimated: false,
        finish: generated.records.response.finish,
        truncated: generated.records.response.truncated,
        delivery: generated.measured.delivery,
      });
      artifacts.cases.push(generated.records.case);
      artifacts.contexts.push({ ...generated.records.context, oracle });
      artifacts.responses.push({
        ...generated.records.response,
        // Keep the selected production raw answer explicit even when delivery
        // did not change it; this makes the X transcript self-describing.
        rawAnswer,
      });
    } else {
      const prompted =
        input.config === "P"
          ? oraclePrompt(oracle)
          : await productionPrompt(testCase).then((value) => ({
              ...value,
              messages: minimalSynthesisMessages(value.context),
            }));
      const generated = await generateRawCapabilityCase({
        engine: input.engine,
        model: input.model,
        testCase,
        prompted: { ...prompted, oracle },
        onDelta: input.onDelta,
        signal: input.signal,
        decoding: input.decoding,
      });
      row = generated.measured;
      artifacts.cases.push(generated.records.case);
      artifacts.contexts.push(generated.records.context);
      artifacts.responses.push(generated.records.response);
    }

    measured.push(row);
    artifacts.manifest.cases = artifacts.responses.length;
    input.onProgress?.({ index, total: cases.length, case: testCase, measured: row });
  }

  return {
    artifacts,
    measured,
    metrics: summarizeCapability(measured),
    profile: capabilityProfile(measured),
    deliveredMetrics: summarizeCapability(
      measured.map((row) => ({
        ...row,
        measurement: row.deliveredMeasurement ?? row.measurement,
        capability: row.deliveredCapability ?? row.capability,
      }))
    ),
  };
}

function oraclePrompt(oracle: OracleContext): {
  messages: GenerationMessage[];
  context: ModelContext;
  oracle: OracleContext;
} {
  return {
    messages: minimalSynthesisMessages(oracle),
    context: oracleModelContext(oracle),
    oracle,
  };
}

function oracleModelContext(oracle: OracleContext): ModelContext {
  const evidence = oracle.evidence.map((item, index) => ({
    knowledgeId: item.knowledgeId,
    chunkId: item.chunkId,
    routeId: item.routeId,
    ...(item.anchor ? { anchor: item.anchor } : {}),
    index: index + 1,
    breadcrumb: item.breadcrumb,
    title: item.title,
    content: item.content,
    role: (item.priority === "core" ? "concept" : item.priority === "supporting" ? "guide" : "reference") as
      | "concept"
      | "guide"
      | "reference",
    reason: "oracle" as const,
    confidence: 1,
    showsRemovedApis: item.showsRemovedApis,
    tokens: item.tokens,
    facets: item.facets,
    section: item.priority,
  }));

  return {
    question: oracle.question,
    locale: oracle.locale,
    scope: "broad",
    answerMode: "explain",
    evidence,
    symbols: [],
    corrections: [],
    navigation: [],
    budget: {
      total: oracle.evidenceLimit,
      reserved: 0,
      evidenceAllowance: oracle.evidenceLimit,
      evidenceUsed: oracle.evidenceTokens,
      droppedForBudget: 0,
      droppedAsRedundant: 0,
    },
    coverage: {
      coverageScore: 1,
      selectedFacetIds: oracle.facets,
      readiness: { sufficient: true, coverage: 1, evidenceCount: evidence.length, sourceConfidence: 1 },
    },
    empty: evidence.length === 0,
  };
}

async function generateRawCapabilityCase(input: {
  engine: KnowledgeEngine;
  model: LanguageModelPort;
  testCase: EvalCase;
  prompted: { messages: GenerationMessage[]; context: ModelContext; oracle: OracleContext };
  decoding?: DecodingSpec;
  onDelta?: (delta: string) => void;
  signal?: AbortSignal;
}): Promise<{
  measured: CapabilityMeasuredCase;
  records: { case: CaseRecord; context: ContextRecord; response: ResponseRecord };
}> {
  const request = {
    messages: input.prompted.messages,
    maxTokens: MAX_TOKENS,
    temperature: input.decoding?.temperature ?? 0,
    ...(input.decoding?.topP !== undefined ? { topP: input.decoding.topP } : {}),
    ...(input.decoding?.topK !== undefined ? { topK: input.decoding.topK } : {}),
    ...(input.decoding?.presencePenalty !== undefined ? { presencePenalty: input.decoding.presencePenalty } : {}),
    ...(input.decoding?.repetitionPenalty !== undefined ? { repetitionPenalty: input.decoding.repetitionPenalty } : {}),
    ...(input.decoding?.id ? { decodingId: input.decoding.id } : {}),
    signal: input.signal ?? new AbortController().signal,
  };
  const started = performance.now();
  const result = input.onDelta ? await input.model.stream(request, input.onDelta) : await input.model.generate(request);
  const latencyMs = performance.now() - started;
  const rawAnswer = result.text;
  const promptTokens =
    result.usage?.promptTokens ?? estimateTokens(input.prompted.messages.map((message) => message.content).join("\n"));
  const promptTokensEstimated = result.usage?.promptTokens === undefined;
  const measurement = measureAnswer({
    answer: rawAnswer,
    case: input.testCase,
    context: input.prompted.context,
    symbols: input.engine.symbols,
    knowledge: input.engine.knowledge,
    corpusKnows: (term) => input.engine.lexical.knows(term),
  });
  const response: ResponseRecord = {
    question: input.testCase.question,
    answer: rawAnswer,
    rawAnswer,
    delivery: "model",
    latencyMs,
    tokensPerSecond: result.timings?.tokensPerSecond ?? null,
    ...(result.timings?.ttftMs ? { ttftMs: result.timings.ttftMs } : {}),
    promptTokens,
    ...(promptTokensEstimated ? { promptTokensEstimated: true } : {}),
    ...(result.usage?.completionTokens !== undefined ? { completionTokens: result.usage.completionTokens } : {}),
    finish: result.finish,
    truncated: result.finish === "length",
  };
  const context: ContextRecord = {
    question: input.testCase.question,
    ...measurement.attribution,
    context: input.prompted.context,
    oracle: input.prompted.oracle,
  };
  const row = makeMeasuredCase({
    testCase: input.testCase,
    oracle: input.prompted.oracle,
    rawAnswer,
    deliveredAnswer: rawAnswer,
    rawMeasurement: measurement,
    deliveredMeasurement: measurement,
    latencyMs,
    tokensPerSecond: result.timings?.tokensPerSecond ?? null,
    ...(result.timings?.ttftMs ? { ttftMs: result.timings.ttftMs } : {}),
    promptTokens,
    completionTokens: result.usage?.completionTokens,
    promptTokensEstimated,
    finish: result.finish,
    truncated: result.finish === "length",
    delivery: "model",
  });
  return {
    measured: row,
    records: {
      case: {
        question: input.testCase.question,
        category: input.testCase.category,
        locale: input.testCase.locale,
        expected: input.testCase.expected,
      },
      context,
      response,
    },
  };
}

function makeMeasuredCase(input: {
  testCase: EvalCase;
  oracle: OracleContext;
  rawAnswer: string;
  deliveredAnswer: string;
  rawMeasurement: MeasuredCase["measurement"];
  deliveredMeasurement: MeasuredCase["measurement"];
  latencyMs: number;
  tokensPerSecond: number | null;
  ttftMs?: number;
  promptTokens?: number;
  completionTokens?: number;
  promptTokensEstimated?: boolean;
  finish?: CapabilityMeasuredCase["finish"];
  truncated?: boolean;
  delivery: CapabilityMeasuredCase["delivery"];
}): CapabilityMeasuredCase {
  return {
    case: input.testCase,
    measurement: input.rawMeasurement,
    rawMeasurement: input.rawMeasurement,
    rawAnswer: input.rawAnswer,
    deliveredAnswer: input.deliveredAnswer,
    deliveredMeasurement: input.deliveredMeasurement,
    capability: measureCapabilityAnswer(input.rawAnswer, input.rawMeasurement, input.oracle),
    deliveredCapability: measureCapabilityAnswer(input.deliveredAnswer, input.deliveredMeasurement, input.oracle),
    delivery: input.delivery,
    latencyMs: input.latencyMs,
    tokensPerSecond: input.tokensPerSecond,
    ...(input.ttftMs !== undefined ? { ttftMs: input.ttftMs } : {}),
    ...(input.promptTokens !== undefined ? { promptTokens: input.promptTokens } : {}),
    ...(input.completionTokens !== undefined ? { completionTokens: input.completionTokens } : {}),
    ...(input.promptTokensEstimated ? { promptTokensEstimated: true } : {}),
    ...(input.finish ? { finish: input.finish } : {}),
    ...(input.truncated !== undefined ? { truncated: input.truncated } : {}),
  };
}

export function measureCapabilityAnswer(
  answer: string,
  measurement: MeasuredCase["measurement"],
  oracle: OracleContext
): CapabilityCaseMeasurement {
  const covered = new Set(
    oracle.facetPriorities.filter((facet) => facetCovered(answer, facet.label)).map((facet) => facet.id)
  );
  const coverageFor = (priority: OracleFacetPriority) => {
    const facets = oracle.facetPriorities.filter((facet) => facet.priority === priority);
    return facets.length === 0 ? 1 : facets.filter((facet) => covered.has(facet.id)).length / facets.length;
  };
  const totalWeight = oracle.facetPriorities.reduce((sum, facet) => sum + CAPABILITY_FACET_WEIGHTS[facet.priority], 0);
  const weightedFacetCoverage =
    totalWeight === 0
      ? 1
      : oracle.facetPriorities.reduce(
          (sum, facet) => sum + (covered.has(facet.id) ? CAPABILITY_FACET_WEIGHTS[facet.priority] : 0),
          0
        ) / totalWeight;
  const rawFacetCoverage = oracle.facetPriorities.length === 0 ? 1 : covered.size / oracle.facetPriorities.length;
  const weightedExplanationCompleteness = weightedFacetCoverage * 0.65 + measurement.audit.grounding.coverage * 0.35;
  const causalCoherence = causalCoherenceProxy(answer, measurement, oracle, covered);
  const usableExplanation =
    weightedExplanationCompleteness >= 0.8 &&
    measurement.audit.grounding.coverage >= 0.95 &&
    measurement.audit.grounding.verdict !== "substantially-ungrounded" &&
    !measurement.audit.findings.some((finding) => finding.kind === "wrong-language") &&
    causalCoherence >= 0.5;

  return {
    weightedFacetCoverage,
    weightedExplanationCompleteness,
    rawFacetCoverage,
    coreFacetCoverage: coverageFor("core"),
    supportingFacetCoverage: coverageFor("supporting"),
    optionalFacetCoverage: coverageFor("optional"),
    causalCoherence,
    usableExplanation,
  };
}

function facetCovered(answer: string, label: string): boolean {
  const labelTokens = new Set(tokenize(label));
  return queryConcepts(answer).some((concept) => concept.variants.some((variant) => labelTokens.has(variant)));
}

/**
 * This is a declared proxy, not a literary-quality score. Every component is
 * inspectable: central-facet coverage, multiple connected facets, a causal
 * marker, non-enumeration, low source copying, grounding, and redundancy.
 */
function causalCoherenceProxy(
  answer: string,
  measurement: MeasuredCase["measurement"],
  oracle: OracleContext,
  covered: ReadonlySet<string>
): number {
  const connected = covered.size >= 2 ? 1 : 0;
  const causalMarker =
    /\b(because|therefore|so|which means|rather than|instead of|when|before|after|por que|porque|portanto|assim|isso significa|em vez de|quando|antes|depois)\b/i.test(
      answer
    )
      ? 1
      : 0;
  const lines = answer.split(/\n+/).filter((line) => line.trim());
  const bullets = lines.filter((line) => /^\s*[-*\d.)]+\s/.test(line)).length;
  const nonEnumeration = bullets < 3 || causalMarker === 1 ? 1 : 0;
  const sourceCopy = oracle.evidence.some((item) => {
    const source = normalizeForCopy(item.content);
    return source.length >= 80 && normalizeForCopy(answer).includes(source.slice(0, Math.min(source.length, 160)));
  })
    ? 0
    : 1;
  const lowRedundancy = Math.max(0, 1 - measurement.redundancy);
  const core = oracle.facetPriorities.filter((facet) => facet.priority === "core");
  const coreCoverage = core.length === 0 ? 1 : core.filter((facet) => covered.has(facet.id)).length / core.length;
  return round(
    (coreCoverage +
      connected +
      causalMarker +
      nonEnumeration +
      sourceCopy +
      measurement.audit.grounding.coverage +
      lowRedundancy) /
      7
  );
}

function normalizeForCopy(value: string): string {
  return value
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function summarizeCapability(cases: readonly CapabilityMeasuredCase[]): CapabilityMetrics {
  const total = cases.length || 1;
  const generation = measureGeneration(cases);
  const average = (pick: (entry: CapabilityMeasuredCase) => number) =>
    cases.reduce((sum, entry) => sum + pick(entry), 0) / total;
  const latencies = cases.map((entry) => entry.latencyMs).sort((left, right) => left - right);
  const ttfts = cases
    .map((entry) => entry.ttftMs)
    .filter((value): value is number => typeof value === "number" && value > 0)
    .sort((left, right) => left - right);
  const prompts = cases.map((entry) => entry.promptTokens).filter((value): value is number => value !== undefined);
  const completions = cases
    .map((entry) => entry.completionTokens)
    .filter((value): value is number => value !== undefined);
  return {
    generation,
    weightedExplanationCompleteness: average((entry) => entry.capability.weightedExplanationCompleteness),
    rawFacetCoverage: average((entry) => entry.capability.rawFacetCoverage),
    coreFacetCoverage: average((entry) => entry.capability.coreFacetCoverage),
    supportingFacetCoverage: average((entry) => entry.capability.supportingFacetCoverage),
    optionalFacetCoverage: average((entry) => entry.capability.optionalFacetCoverage),
    causalCoherence: average((entry) => entry.capability.causalCoherence),
    usableExplanation: average((entry) => Number(entry.capability.usableExplanation)),
    runtime: {
      medianLatencyMs: percentile(latencies, 0.5),
      p95LatencyMs: percentile(latencies, 0.95),
      medianTtftMs: ttfts.length === 0 ? null : percentile(ttfts, 0.5),
      tokensPerSecond: cases.some(
        (entry) => entry.completionTokens !== undefined || (entry.tokensPerSecond !== null && entry.tokensPerSecond > 0)
      )
        ? generation.tokensPerSecond
        : null,
      promptTokens:
        prompts.length === 0 ? null : Math.round(prompts.reduce((sum, value) => sum + value, 0) / prompts.length),
      completionTokens:
        completions.length === 0
          ? null
          : Math.round(completions.reduce((sum, value) => sum + value, 0) / completions.length),
      promptTokensEstimated: cases.some((entry) => entry.promptTokensEstimated === true),
    },
  };
}

/**
 * A profile is a projection of measured behavior, never a lookup by model
 * size. Explanation cases cannot establish navigation or exact lookup, so
 * those capabilities remain explicitly unmeasured until their own suites
 * exist.
 */
export function capabilityProfile(cases: readonly CapabilityMeasuredCase[]): ModelCapabilityProfile {
  const level = (
    value: number,
    thresholds: { strong: number; acceptable: number; weak: number }
  ): ModelCapabilityLevel =>
    value >= thresholds.strong
      ? "strong"
      : value >= thresholds.acceptable
        ? "acceptable"
        : value >= thresholds.weak
          ? "weak"
          : "unsupported";
  const overall = summarizeCapability(cases);
  const explanation =
    cases.length === 0
      ? "unmeasured"
      : level(overall.weightedExplanationCompleteness, { strong: 0.9, acceptable: 0.8, weak: 0.7 });
  const causal = level(overall.causalCoherence, { strong: 0.8, acceptable: 0.65, weak: 0.5 });
  const grounding = overall.generation.groundingCoverage;
  const groundedSynthesis =
    cases.length === 0
      ? "unmeasured"
      : grounding >= 0.95 && overall.generation.substantiallyUngrounded <= 0.05
        ? "strong"
        : grounding >= 0.8 && overall.generation.substantiallyUngrounded <= 0.2
          ? "acceptable"
          : grounding >= 0.5
            ? "weak"
            : "unsupported";

  const localeLevel = (locale: Locale): ModelCapabilityLevel => {
    const localeCases = cases.filter((entry) => entry.case.locale === locale);
    if (localeCases.length === 0) return "unmeasured";
    return level(summarizeCapability(localeCases).weightedExplanationCompleteness, {
      strong: 0.9,
      acceptable: 0.8,
      weak: 0.7,
    });
  };

  return {
    navigation: "unmeasured",
    lookup: "unmeasured",
    explain: explanation,
    deepExplain: cases.length === 0 ? "unmeasured" : causal === "unsupported" ? "unsupported" : explanation,
    groundedSynthesis,
    portuguese: localeLevel("pt-BR"),
    english: localeLevel("en"),
  };
}

function percentile(values: readonly number[], fraction: number): number {
  if (values.length === 0) return 0;
  return Math.round(values[Math.min(values.length - 1, Math.floor((values.length - 1) * fraction))] ?? 0);
}

export function diagnoseCapabilityCase(
  p: CapabilityMeasuredCase,
  r: CapabilityMeasuredCase,
  x: CapabilityMeasuredCase
): CapabilityDiagnosis {
  if (!passesCase(p)) return "model-capability";
  if (!passesCase(r)) return "context-loss";
  // X is judged against the raw production answer. A successful fallback is
  // reported separately as delivery recovery and must not erase a protocol
  // rejection in the diagnosis.
  if (!passesCase(x) || productionRejected(x)) return "protocol-overload";
  return "production-success";
}

function passesCase(entry: CapabilityMeasuredCase): boolean {
  return entry.capability.usableExplanation;
}

function productionRejected(entry: CapabilityMeasuredCase): boolean {
  return entry.measurement !== undefined && new StrictAuditPolicy().shouldReject(entry.measurement.audit);
}

export interface CapabilityGapDecomposition {
  modelCeiling: number;
  contextLoss: number;
  protocolLoss: number;
  deliveryRecovery: number;
}

export function gapDecomposition(
  p: CapabilityMetrics,
  r: CapabilityMetrics,
  xRaw: CapabilityMetrics,
  xDelivered: CapabilityMetrics
): CapabilityGapDecomposition {
  return {
    modelCeiling: p.weightedExplanationCompleteness,
    contextLoss: p.weightedExplanationCompleteness - r.weightedExplanationCompleteness,
    protocolLoss: r.weightedExplanationCompleteness - xRaw.weightedExplanationCompleteness,
    deliveryRecovery: xDelivered.weightedExplanationCompleteness - xRaw.weightedExplanationCompleteness,
  };
}

export type CapabilityVerdict = "quality-pass" | "smoke-fail" | "full-fail" | "pending-full";

export interface CapabilityGateResult {
  passed: boolean;
  reasons: string[];
}

export function smokeGate(metrics: CapabilityMetrics): CapabilityGateResult {
  const reasons: string[] = [];
  if (metrics.weightedExplanationCompleteness < 0.7) reasons.push("weighted completeness < 70%");
  if (metrics.coreFacetCoverage < 0.85) reasons.push("core facet coverage < 85%");
  if (metrics.generation.substantiallyUngrounded > 0.2) reasons.push("substantially ungrounded > 20%");
  if (metrics.generation.wrongLanguage > 0.1) reasons.push("wrong language > 10%");
  if (metrics.generation.inventedSymbol > 0) reasons.push("invented symbol is present");
  if (metrics.generation.fabricatedEntity > 0 || metrics.generation.fabricatedHistory > 0)
    reasons.push("fabricated entity/history is present");
  if (metrics.generation.degenerated > 0) reasons.push("repeated degeneration is present");
  if (metrics.causalCoherence < 0.5) reasons.push("outputs do not show the causal proxy floor");
  return { passed: reasons.length === 0, reasons };
}

export function fullCapabilityGate(metrics: CapabilityMetrics): CapabilityGateResult {
  const reasons: string[] = [];
  if (metrics.coreFacetCoverage < 0.9) reasons.push("core facet coverage < 90%");
  if (metrics.weightedExplanationCompleteness < 0.8) reasons.push("weighted explanation completeness < 80%");
  if (metrics.generation.groundingCoverage < 0.95) reasons.push("grounding coverage < 95%");
  if (metrics.generation.substantiallyUngrounded > 0.05) reasons.push("substantially ungrounded > 5%");
  if (metrics.generation.inventedSymbol > 0) reasons.push("invented symbol is not zero");
  if (metrics.generation.fabricatedEntity > 0 || metrics.generation.fabricatedHistory > 0)
    reasons.push("fabricated entity/history is not zero");
  if (metrics.generation.wrongLanguage > 0.025) reasons.push("wrong language > 2.5%");
  if (metrics.usableExplanation < 0.85) reasons.push("usable explanations < 85%");
  return { passed: reasons.length === 0, reasons };
}

export function decideCapabilityVerdict(input: {
  smoke: CapabilityGateResult;
  full?: CapabilityGateResult;
}): CapabilityVerdict | null {
  if (!input.smoke.passed) return "smoke-fail";
  if (!input.full) return "pending-full";
  return input.full.passed ? "quality-pass" : "full-fail";
}

function round(value: number): number {
  return Math.round(Math.min(1, Math.max(0, value)) * 100) / 100;
}
