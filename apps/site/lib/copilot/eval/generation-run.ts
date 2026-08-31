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
import type { ContextService } from "../application/context/context.service";
import { promptOverhead, renderMessages } from "../application/context/render";
import { CONTEXT_BUDGET } from "../config/retrieval";
import type { ModelContext } from "../core/entities/model-context";
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
export function pipelinePrompt(engine: KnowledgeEngine, contextService: ContextService): PromptForCase {
  return async (testCase: EvalCase) => {
    const report = await engine.retriever.retrieve(testCase.question, {
      context: { locale: testCase.locale, ...(testCase.context?.routeId ? { routeId: testCase.context.routeId } : {}) },
      queryVector: null,
    });

    const context = contextService.build({
      question: testCase.question,
      locale: testCase.locale,
      report,
      budget: CONTEXT_BUDGET.hard,
      reservedTokens: promptOverhead(engine.symbols, {
        question: testCase.question,
        exactSymbols: report.exactSymbols,
      }),
      ...(testCase.context?.routeId ? { current: { routeId: testCase.context.routeId } } : {}),
    });

    return { messages: renderMessages(context, { symbols: engine.symbols }), context };
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
  const { messages, context } = await input.prompt(testCase);

  const request = {
    messages,
    maxTokens: input.maxTokens ?? MAX_TOKENS,
    temperature: 0,
    signal: input.signal ?? new AbortController().signal,
  };

  const started = performance.now();
  const result = input.onDelta ? await input.model.stream(request, input.onDelta) : await input.model.generate(request);
  const latencyMs = performance.now() - started;

  const measurement = measureAnswer({
    answer: result.text,
    case: testCase,
    context,
    symbols: input.engine.symbols,
    knowledge: input.engine.knowledge,
    corpusKnows: (term) => input.engine.lexical.knows(term),
  });

  const tokensPerSecond = result.timings?.tokensPerSecond ?? 0;

  return {
    measured: { case: testCase, measurement, latencyMs, tokensPerSecond },
    records: {
      case: {
        question: testCase.question,
        category: testCase.category,
        locale: testCase.locale,
        expected: testCase.expected,
      },
      context: { question: testCase.question, ...measurement.attribution, context },
      response: {
        question: testCase.question,
        answer: result.text,
        latencyMs,
        tokensPerSecond,
        // Node cannot observe it and reports 0; a zero would read as instant.
        ...(result.timings?.ttftMs ? { ttftMs: result.timings.ttftMs } : {}),
        ...(result.usage?.promptTokens !== undefined ? { promptTokens: result.usage.promptTokens } : {}),
        ...(result.usage?.completionTokens !== undefined ? { completionTokens: result.usage.completionTokens } : {}),
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
