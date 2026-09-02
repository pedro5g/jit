/**
 * One case, generated and recorded — shared by every runtime that runs the set.
 *
 * §PART 26 adds a second runtime: the browser, where the model a reader
 * actually gets finally runs. Two runtimes measuring the same thing is one
 * measurement system only while they share the code that decides a number, so
 * the prompt, the generation call and the three records live here rather than
 * once in the headless script and again in a page.
 *
 * What stays outside is everything environment-shaped: which artifacts to
 * load, which model to construct, where to write the run. Those legitimately
 * differ, and pretending otherwise is what produces a browser path that quietly
 * became a copy.
 */
import { retryInstruction, StrictAuditPolicy } from "../application/audit/audit.service";
import type { ContextService } from "../application/context/context.service";
import { promptOverhead, renderMessages } from "../application/context/render";
import { buildCoveragePlan } from "../application/coverage/coverage-pipeline";
import { GroundedSynthesisService } from "../application/services/grounded-synthesis.service";
import { stripToolCalls } from "../application/tools/parse-tool-calls";
import { CONTEXT_BUDGET } from "../config/retrieval";
import type { ModelContext } from "../core/entities/model-context";
import type { RetrievalReport } from "../core/entities/retrieval";
import type { EmbeddingPort } from "../core/ports/embedding";
import type { GenerationMessage, LanguageModelPort } from "../core/ports/language-model";
import type { KnowledgeEngine } from "../infrastructure/knowledge-engine";
import type { CaseRecord, ContextRecord, ResponseRecord } from "./artifacts";
import { type MeasuredCase, measureAnswer } from "./detectors";
import type { EvalCase } from "./types";

/** Answer length, identical across runtimes so latency is comparable. */
export const MAX_TOKENS = 400;

export interface PromptedCase {
  messages: GenerationMessage[];
  context: ModelContext;
  retrievalTimings?: RetrievalReport["timings"];
}

/** Builds the prompt for one question. */
export type PromptForCase = (testCase: EvalCase) => Promise<PromptedCase>;

/**
 * The pipeline's own prompt: retrieve, build a context, render it.
 *
 * Semantic retrieval is off, and for two reasons that happen to agree. In Node
 * the query embedder would run on CPU for every case, and the retrieval eval
 * already reports both halves. In the browser it would run — but a browser run
 * exists to be compared against a headless one, and a context built from a
 * different retrieval is not the same context. The model is the variable; the
 * evidence must not be.
 */
export function pipelinePrompt(
  engine: KnowledgeEngine,
  contextService: ContextService,
  embedder: EmbeddingPort | null = null
): PromptForCase {
  return async (testCase: EvalCase) => {
    const embeddingStart = performance.now();
    const queryVector = embedder ? await embedder.embed(testCase.question) : null;
    const queryEmbeddingMs = performance.now() - embeddingStart;
    const report = await engine.retriever.retrieve(testCase.question, {
      context: { locale: testCase.locale, ...(testCase.context?.routeId ? { routeId: testCase.context.routeId } : {}) },
      queryVector,
    });
    report.timings.queryEmbeddingMs = embedder ? queryEmbeddingMs : 0;
    report.timings.totalSemanticMs = report.timings.semanticMs + queryEmbeddingMs;
    const plan = buildCoveragePlan(engine, testCase.question, report, testCase.locale);
    const knownSymbols = plan.scope === "broad" ? report.explicitSymbols : report.exactSymbols;

    const context = contextService.build({
      question: testCase.question,
      locale: testCase.locale,
      report,
      plan,
      budget: CONTEXT_BUDGET.hard,
      reservedTokens: promptOverhead(engine.symbols, {
        question: testCase.question,
        exactSymbols: knownSymbols,
        answerMode: plan.answerMode,
      }),
      ...(testCase.context?.routeId ? { current: { routeId: testCase.context.routeId } } : {}),
    });

    return {
      messages: renderMessages(context, { symbols: engine.symbols }),
      context,
      retrievalTimings: report.timings,
    };
  };
}

export interface GeneratedCase {
  /** Scored with the product's detectors, under the shadow policy. */
  measured: MeasuredCase;
  /** The three streams, ready to be appended to a run's artifacts. */
  records: { case: CaseRecord; context: ContextRecord; response: ResponseRecord };
}

export interface GenerateCaseInput {
  engine: KnowledgeEngine;
  model: LanguageModelPort;
  prompt: PromptForCase;
  case: EvalCase;
  maxTokens?: number;
  /** Deltas, when the host has a screen to put them on. */
  onDelta?: (delta: string) => void;
  signal?: AbortSignal;
}

export async function generateCase(input: GenerateCaseInput): Promise<GeneratedCase> {
  const testCase = input.case;
  const { messages, context, retrievalTimings } = await input.prompt(testCase);

  const request = {
    messages,
    maxTokens: input.maxTokens ?? MAX_TOKENS,
    temperature: 0,
    signal: input.signal ?? new AbortController().signal,
  };

  const policy = new StrictAuditPolicy(true);
  const started = performance.now();
  const result = input.onDelta ? await input.model.stream(request, () => {}) : await input.model.generate(request);

  let selectedResult = result;
  let rawAnswer = stripToolCalls(result.text);
  let rawMeasurement = measureAnswer({
    answer: rawAnswer,
    case: testCase,
    context,
    symbols: input.engine.symbols,
    knowledge: input.engine.knowledge,
    corpusKnows: (term) => input.engine.lexical.knows(term),
  });

  /**
   * Benchmark the answer the reader would receive, not only the model's raw
   * prose. This is the same deterministic safety boundary as the product:
   * salvage only mapped unsupported sentences, otherwise expose verified
   * source excerpts. The raw measurement remains beside it so a fallback can
   * never make model weakness disappear from the report.
   */
  const grounded = new GroundedSynthesisService();

  // Exercise the same single constrained retry as production. A successful
  // retry must improve delivery before the deterministic fallback is tried.
  if (policy.shouldRetry(rawMeasurement.audit) && result.finish !== "aborted") {
    const retryRequest = {
      ...request,
      messages: [
        ...messages,
        { role: "assistant" as const, content: rawAnswer },
        { role: "user" as const, content: retryInstruction(rawMeasurement.audit.findings, input.engine.symbols) },
      ],
    };
    const retry = input.onDelta
      ? await input.model.stream(retryRequest, () => {})
      : await input.model.generate(retryRequest);
    const retryAnswer = stripToolCalls(retry.text);
    const retryMeasurement = measureAnswer({
      answer: retryAnswer,
      case: testCase,
      context,
      symbols: input.engine.symbols,
      knowledge: input.engine.knowledge,
      corpusKnows: (term) => input.engine.lexical.knows(term),
    });

    if (
      !policy.shouldReject(retryMeasurement.audit) ||
      retryMeasurement.audit.findings.length < rawMeasurement.audit.findings.length
    ) {
      selectedResult = retry;
      rawAnswer = retryAnswer;
      rawMeasurement = retryMeasurement;
    }
  }

  const latencyMs = performance.now() - started;

  let answer = rawAnswer;
  let sourceOnly = false;
  let delivery: "model" | "salvage" | "grounded-synthesis" = "model";

  if (policy.shouldReject(rawMeasurement.audit)) {
    const salvaged = grounded.salvage(rawAnswer, rawMeasurement.audit);
    if (salvaged) {
      const salvageMeasurement = measureAnswer({
        answer: salvaged,
        case: testCase,
        context,
        symbols: input.engine.symbols,
        knowledge: input.engine.knowledge,
        corpusKnows: (term) => input.engine.lexical.knows(term),
      });
      if (!policy.shouldReject(salvageMeasurement.audit)) {
        answer = salvaged;
        delivery = "salvage";
      }
    }
    if (delivery === "model") {
      answer = grounded.synthesize(context);
      sourceOnly = true;
      delivery = "grounded-synthesis";

      // The benchmark measures the same delivery boundary as production. A
      // deterministic excerpt should pass, but if a validator finds a fatal
      // problem in it, record a claim-free response instead of treating the
      // fallback as automatically trusted.
      const fallbackMeasurement = measureAnswer({
        answer,
        case: testCase,
        context,
        symbols: input.engine.symbols,
        knowledge: input.engine.knowledge,
        corpusKnows: (term) => input.engine.lexical.knows(term),
        sourceOnly: true,
      });
      if (policy.shouldReject(fallbackMeasurement.audit)) {
        answer =
          testCase.locale === "pt-BR"
            ? "Não encontrei evidência suficiente na documentação atual para responder com segurança."
            : "I found no evidence in the current documentation to answer safely.";
      }
    }
  }

  const measurement = measureAnswer({
    answer,
    case: testCase,
    context,
    symbols: input.engine.symbols,
    knowledge: input.engine.knowledge,
    corpusKnows: (term) => input.engine.lexical.knows(term),
    sourceOnly,
  });
  input.onDelta?.(answer);

  const tokensPerSecond = selectedResult.timings?.tokensPerSecond ?? 0;

  return {
    measured: {
      case: testCase,
      measurement,
      rawMeasurement: rawMeasurement,
      delivery,
      latencyMs,
      tokensPerSecond,
      ...(retrievalTimings ? { retrievalTimings } : {}),
    },
    records: {
      case: {
        question: testCase.question,
        category: testCase.category,
        locale: testCase.locale,
        expected: testCase.expected,
      },
      context: {
        question: testCase.question,
        ...measurement.attribution,
        context,
        ...(retrievalTimings ? { retrievalTimings } : {}),
      },
      response: {
        question: testCase.question,
        answer,
        ...(answer !== rawAnswer ? { rawAnswer } : {}),
        delivery,
        latencyMs,
        tokensPerSecond,
        // Node cannot observe it and reports 0; a zero would read as instant.
        ...(selectedResult.timings?.ttftMs ? { ttftMs: selectedResult.timings.ttftMs } : {}),
        ...(selectedResult.usage?.promptTokens !== undefined
          ? { promptTokens: selectedResult.usage.promptTokens }
          : {}),
        ...(selectedResult.usage?.completionTokens !== undefined
          ? { completionTokens: selectedResult.usage.completionTokens }
          : {}),
      },
    },
  };
}

/** The fatal findings, abbreviated, for a progress line during a long run. */
export function fatalFlags(measured: MeasuredCase): string {
  return measured.measurement.audit.findings
    .filter((finding) => finding.severity === "fatal")
    .map((finding) => finding.kind)
    .join(" ");
}
