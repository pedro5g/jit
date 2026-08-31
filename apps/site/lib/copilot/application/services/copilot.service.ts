/**
 * The orchestrator, and the only place the whole flow is visible.
 *
 * §49, in order: resolve what the question is about, retrieve, build context,
 * generate, audit, retry once if the audit rejected it, respond.
 *
 * Every step above the model is deterministic and independently testable, and
 * that is the design rather than an accident. The model is one call in the
 * middle of this file; everything else — what was retrieved, what the context
 * held, what the audit found — is a value the eval suite reads directly, with
 * no model loaded at all.
 */
import { CONTEXT_BUDGET, RETRIEVAL_LIMIT } from "../../config/retrieval";
import type { CopilotAction, CopilotAnswer } from "../../core/entities/answer";
import type { AuditPolicy } from "../../core/entities/audit";
import type { ModelContext } from "../../core/entities/model-context";
import type { RetrievalReport } from "../../core/entities/retrieval";
import { MAX_TOOL_CALLS } from "../../core/entities/tool";
import type { CodeExampleVerifierPort } from "../../core/ports/code-example-verifier";
import type { EmbeddingPort } from "../../core/ports/embedding";
import type { GenerationMessage, LanguageModelPort } from "../../core/ports/language-model";
import { type LoggerPort, silentLogger } from "../../core/ports/logger";
import type { RouteId } from "../../core/value-objects/ids";
import { detectLocale, type Locale } from "../../core/value-objects/locale";
import type { KnowledgeEngine } from "../../infrastructure/knowledge-engine";
import { fallbackNavigation, parseActions } from "../actions/parse-actions";
import { type AuditService, retryInstruction, ShadowAuditPolicy } from "../audit/audit.service";
import type { ContextService } from "../context/context.service";
import { promptOverhead, renderMessages } from "../context/render";
import { parseToolCalls, stripToolCalls } from "../tools/parse-tool-calls";
import { runTool } from "../tools/registry";

export interface AskInput {
  question: string;
  /** The page the reader is on, as a signal (§34), never as a truth. */
  routeId?: RouteId;
  anchor?: string;
  /** Text the reader highlighted before asking. */
  selectedText?: string;
  /** Prior turns, oldest first. */
  history?: GenerationMessage[];
  /** Overrides the language detected from the question. */
  locale?: Locale;
  signal?: AbortSignal;
  /** Called with each delta, for the streaming UI. */
  onDelta?: (delta: string) => void;
}

export interface CopilotServiceDeps {
  engine: KnowledgeEngine;
  context: ContextService;
  audit: AuditService;
  logger?: LoggerPort;
  /**
   * What the product does about what the audit found — §PART 22.
   *
   * Detection is not policy. The validators always run; this decides whether a
   * fatal finding blocks the answer. Shadow is the default until the
   * false-positive rate has been measured over real transcripts: rejecting on
   * a detector nobody has validated costs the reader an answer that was fine.
   */
  policy?: AuditPolicy;
  /** Browser implementation executes code in a disposable worker. */
  examples?: CodeExampleVerifierPort;
}

/**
 * Questions where the changelog and the migration guide are the right answer.
 *
 * Everywhere else they are actively misleading — they describe a delta to
 * someone who has never seen the thing it applies to — so they are ranked down
 * by default and let back in only here.
 */
const ABOUT_A_VERSION =
  /\b(2\.0|v2|1\.x|changed|changelog|breaking|migrat|migro|migrar|vers[ãa]o|version|novidades|what's new)\b/i;

/** Tokens an answer gets. Enough for three paragraphs and one code block. */
const MAX_ANSWER_TOKENS = 700;

export class CopilotService {
  private readonly logger: LoggerPort;

  constructor(private readonly deps: CopilotServiceDeps) {
    this.logger = deps.logger ?? silentLogger;
  }

  /**
   * Retrieval on its own, for the capability level where no model runs.
   *
   * §78: a browser with no WebGPU still gets a working documentation search,
   * and the way that stays true is that search is a separate entry point
   * rather than a degraded path through generation.
   */
  async search(
    input: AskInput,
    embedder: EmbeddingPort | null
  ): Promise<{ report: RetrievalReport; context: ModelContext }> {
    const locale = input.locale ?? detectLocale(input.question);
    this.logger.emit({
      type: "query.received",
      locale,
      length: input.question.length,
    });

    const started = performance.now();
    const report = await this.retrieve(input, embedder);
    this.logger.emit({
      type: "retrieval.finished",
      results: report.results.length,
      exactSymbols: report.exactSymbols.length,
      ms: performance.now() - started,
    });

    return { report, context: this.buildContext(input, report, locale) };
  }

  private async retrieve(input: AskInput, embedder: EmbeddingPort | null): Promise<RetrievalReport> {
    const locale = input.locale ?? detectLocale(input.question);

    // A missing embedder is a capability level, not an error; a failing one is
    // a degraded level. Neither is allowed to take retrieval down with it.
    const queryVector = embedder ? await embedder.embed(input.question).catch(() => null) : null;

    return this.deps.engine.retriever.retrieve(input.question, {
      context: {
        locale,
        ...(input.routeId ? { routeId: input.routeId } : {}),
        ...(input.anchor ? { anchor: input.anchor } : {}),
      },
      queryVector,
      limit: RETRIEVAL_LIMIT,
      allowHistory: ABOUT_A_VERSION.test(input.question),
    });
  }

  private buildContext(input: AskInput, report: RetrievalReport, locale: Locale): ModelContext {
    const reservedTokens = promptOverhead(this.deps.engine.symbols, {
      question: input.question,
      exactSymbols: report.exactSymbols,
    });

    const context = this.deps.context.build({
      question: input.question,
      locale,
      report,
      reservedTokens,
      budget: CONTEXT_BUDGET.hard,
      ...(input.routeId
        ? {
            current: {
              routeId: input.routeId,
              ...(input.anchor ? { anchor: input.anchor } : {}),
              ...(input.selectedText ? { selectedText: input.selectedText } : {}),
            },
          }
        : {}),
    });

    this.logger.emit({
      type: "context.built",
      chunks: context.evidence.length,
      approximateTokens: context.budget.evidenceUsed,
    });

    return context;
  }

  /**
   * The full flow.
   *
   * `model` is passed in rather than held, so the service genuinely does not
   * know which one answered — §40's requirement, and the reason swapping a
   * 0.8B for Chrome's built-in model changes nothing here.
   */
  async ask(input: AskInput, model: LanguageModelPort, embedder: EmbeddingPort | null): Promise<CopilotAnswer> {
    const locale = input.locale ?? detectLocale(input.question);
    const signal = input.signal ?? new AbortController().signal;

    const retrievalStart = performance.now();
    const report = await this.retrieve(input, embedder);
    const retrievalMs = performance.now() - retrievalStart;

    const contextStart = performance.now();
    const context = this.buildContext(input, report, locale);
    const contextMs = performance.now() - contextStart;

    if (context.empty) {
      const text =
        locale === "pt-BR"
          ? "Não encontrei evidência sobre isso na documentação atual."
          : "I found no evidence about that in the current documentation.";
      const auditStart = performance.now();
      const audit = this.audit(text, context, report);

      return {
        text,
        locale,
        actions: [],
        citations: [],
        evidence: [],
        audit,
        retried: false,
        rejected: false,
        insufficientEvidence: true,
        timings: {
          retrievalMs,
          contextMs,
          generationMs: 0,
          auditMs: performance.now() - auditStart,
        },
      };
    }

    const messages = renderMessages(context, {
      symbols: this.deps.engine.symbols,
      ...(input.history ? { history: input.history } : {}),
    });

    const generationStart = performance.now();
    this.logger.emit({ type: "generation.started", model: model.id });

    let result = await model.stream(
      { messages, maxTokens: MAX_ANSWER_TOKENS, temperature: 0, signal },
      input.onDelta ?? (() => {})
    );

    const toolMessages = [...messages];
    const seenTools = new Set<string>();
    let callsUsed = 0;

    while (!signal.aborted && callsUsed < MAX_TOOL_CALLS) {
      const calls = parseToolCalls(result.text).filter((call) => {
        const key = `${call.name}:${call.input}`;
        if (seenTools.has(key)) return false;
        seenTools.add(key);
        return true;
      });

      const accepted = calls.slice(0, MAX_TOOL_CALLS - callsUsed);
      if (accepted.length === 0) break;

      const results = await Promise.all(
        accepted.map((call) =>
          runTool(call, {
            symbols: this.deps.engine.symbols,
            knowledge: this.deps.engine.knowledge,
            routes: this.deps.engine.routes,
            retriever: this.deps.engine.retriever,
            locale,
          })
        )
      );

      callsUsed += results.length;
      for (const tool of results)
        this.logger.emit({
          type: "tool.called",
          tool: tool.call.name,
          ok: tool.hit,
        });

      toolMessages.push(
        { role: "assistant", content: result.text },
        {
          role: "user",
          content: [
            "Tool results (deterministic; use only these results and the original evidence):",
            ...results.map(
              (tool) =>
                `[${tool.call.name}:${tool.call.input}]\n${tool.hit ? tool.output : "No result. Do not guess an answer."}`
            ),
            "Now answer the original question. Do not repeat tool-call tags.",
          ].join("\n\n"),
        }
      );

      result = await model.stream(
        {
          messages: toolMessages,
          maxTokens: MAX_ANSWER_TOKENS,
          temperature: 0,
          signal,
        },
        input.onDelta ?? (() => {})
      );
    }

    result = { ...result, text: stripToolCalls(result.text) };

    let audit = await this.auditWithExamples(result.text, context, report, signal);
    let retried = false;

    /**
     * One retry, with the findings stated (§58).
     *
     * Exactly one, because a second rarely differs from the first and the
     * reader is waiting. And only for a severe finding: regenerating over an
     * unsupported figure spends thirty seconds to move a footnote.
     */
    const policy = this.deps.policy ?? new ShadowAuditPolicy();

    if (policy.shouldRetry(audit) && !signal.aborted && result.finish !== "aborted") {
      retried = true;

      const corrected = [
        ...messages,
        { role: "assistant" as const, content: result.text },
        {
          role: "user" as const,
          content: retryInstruction(audit.findings, this.deps.engine.symbols),
        },
      ];

      const second = await model.stream(
        {
          messages: corrected,
          maxTokens: MAX_ANSWER_TOKENS,
          temperature: 0,
          signal,
        },
        input.onDelta ?? (() => {})
      );

      const secondAudit = await this.auditWithExamples(second.text, context, report, signal);

      // The first answer is kept when the retry is no better: a second attempt
      // that fails differently is not progress, and the reader gets the one
      // with fewer problems.
      if (!policy.shouldReject(secondAudit) || secondAudit.findings.length < audit.findings.length) {
        result = second;
        audit = secondAudit;
      }
    }

    const generationMs = performance.now() - generationStart;
    this.logger.emit({
      type: "generation.finished",
      finish: result.finish,
      ms: generationMs,
      ...(result.timings ? { tokensPerSecond: result.timings.tokensPerSecond } : {}),
    });

    const auditStart = performance.now();
    const parsed = parseActions({
      answer: result.text,
      evidence: context.evidence,
      routes: this.deps.engine.routes,
      locale,
    });

    const actions: CopilotAction[] = [...parsed.actions];
    const fallback = fallbackNavigation(context.evidence, actions);
    if (fallback) actions.push(fallback);

    this.logger.emit({
      type: "audit.finished",
      valid: !policy.shouldReject(audit),
      findings: audit.findings.length,
    });

    const rejected = policy.shouldReject(audit);
    const text = rejected
      ? locale === "pt-BR"
        ? "Não consegui verificar esta resposta com evidência suficiente. As fontes abaixo são o resultado confiável que encontrei."
        : "I could not verify this answer with enough evidence. The sources below are the reliable result I found."
      : parsed.text;

    return {
      text,
      locale,
      actions,
      citations: context.evidence.map((evidence) => {
        const path = this.deps.context.pathFor(evidence, locale);
        return {
          index: evidence.index,
          routeId: evidence.routeId,
          ...(path ? { path } : {}),
          breadcrumb: evidence.breadcrumb,
        };
      }),
      evidence: context.evidence,
      audit,
      retried,
      rejected,
      insufficientEvidence: context.empty,
      timings: {
        retrievalMs,
        contextMs,
        generationMs,
        auditMs: performance.now() - auditStart,
      },
    };
  }

  private audit(answer: string, context: ModelContext, report: RetrievalReport) {
    const best = report.results[0];

    // How many independent retrievers agreed on the best result — the strongest
    // evidence the fusion produces, and what §60 turns into confidence.
    const agreement = best ? Object.values(best.scores).filter((score) => score !== undefined).length : 0;

    return this.deps.audit.run({
      question: context.question,
      answer,
      locale: context.locale,
      modelContext: context,
      symbols: this.deps.engine.symbols,
      knowledge: this.deps.engine.knowledge,
      corpusKnows: (term) => this.deps.engine.lexical.knows(term),
      topScore: best?.finalScore ?? 0,
      agreement,
    });
  }

  private async auditWithExamples(answer: string, context: ModelContext, report: RetrievalReport, signal: AbortSignal) {
    const audit = this.audit(answer, context, report);
    const verifier = this.deps.examples;
    if (!verifier) return audit;

    const verified = await verifier.verify(answer, signal).catch((error: unknown) => ({
      ok: false as const,
      error: error instanceof Error ? error.message : "Example verification failed.",
    }));
    if (verified.ok) return audit;

    const finding = {
      kind: "invalid-example" as const,
      severity: "fatal" as const,
      origin: "model_failure" as const,
      detail: `The code example was discarded because it did not execute successfully: ${verified.error ?? "unknown error"}`,
      offenders: [verified.error ?? "execution failed"],
      source: "example-execution",
    };

    return {
      ...audit,
      findings: [...audit.findings, finding],
      classification: {
        kinds: [...new Set([...audit.classification.kinds, finding.kind])],
        origins: [...new Set([...audit.classification.origins, finding.origin])],
      },
    };
  }
}
