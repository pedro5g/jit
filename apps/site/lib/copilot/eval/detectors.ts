/**
 * Measuring an answer without a judge model.
 *
 * This is now a thin layer over `AuditService` running under a policy that
 * blocks nothing — §PART 24's shadow mode. That the benchmark and the product
 * share one detector set is the point: a number in a report and a banner shown
 * to a reader come from the same code, so improving one cannot silently
 * diverge from the other.
 *
 * Nothing here asks a second model whether the first was right. An
 * LLM-as-judge would be the single component whose verdicts nothing could
 * check, and the whole design exists to avoid exactly that.
 *
 * What that costs is honesty about coverage. "Factual correctness" is not
 * measurable this way, so it is not claimed. What is claimed — a name exists,
 * a claim traces to evidence, a route was shown, the reply is in the reader's
 * language — is checkable against the index and the context.
 */
import { AuditService, ShadowAuditPolicy, StrictAuditPolicy } from "../application/audit/audit.service.js";
import { overlap } from "../application/context/stages.js";
import { queryConcepts, tokenize } from "../application/retrieval/tokenizer.js";
import type { AuditResult } from "../core/entities/audit.js";
import type { FailureKind, FailureOrigin } from "../core/entities/claim.js";
import type { ModelContext } from "../core/entities/model-context.js";
import type { RetrievalReport } from "../core/entities/retrieval.js";
import type { KnowledgeRepository, SymbolRepository } from "../core/repositories/index.js";
import type { EvalCase } from "./types.js";

const shadow = new ShadowAuditPolicy();

export interface AnswerMeasurement {
  answered: boolean;
  audit: AuditResult;

  /** `[[go:…]]` naming a route the answer was never shown. */
  wrongNavigation: string[];
  /** Whether the answer offered a link at all, which the rate above needs. */
  offeredNavigation: boolean;
  /** Whether the answer showed a fenced code block. */
  showedCode: boolean;
  /** The answer points at its evidence with `[n]`. */
  citesSource: boolean;
  /**
   * The answer names the API the case expects.
   *
   * A proxy for factual correctness on lookup questions, and only that: it
   * says the right name appeared, not that what was said about it is true.
   */
  namesExpectedSymbol: boolean | null;
  explanationCompleteness: number | null;
  facetCoverage: number | null;
  specificity: number;
  redundancy: number;

  /**
   * What the answer was shown, kept beside what it said — §PART 10.
   *
   * Without this, "the model invented it" and "the context was already wrong"
   * are indistinguishable after the fact, and every failure gets blamed on the
   * model by default.
   */
  attribution: {
    knowledgeIds: string[];
    chunkIds: string[];
    symbolIds: string[];
    routeIds: string[];
    contextTokens: number;
    retrievalReasons: string[];
  };

  characters: number;
}

export interface MeasureInput {
  answer: string;
  case: EvalCase;
  context: ModelContext;
  symbols: SymbolRepository;
  knowledge: KnowledgeRepository;
  corpusKnows: (term: string) => boolean;
  topScore?: number;
  agreement?: number;
  sourceOnly?: boolean;
}

export function measureAnswer(input: MeasureInput): AnswerMeasurement {
  const audit = new AuditService().run({
    question: input.case.question,
    answer: input.answer,
    locale: input.case.locale,
    ...(input.sourceOnly ? { sourceOnly: true } : {}),
    modelContext: input.context,
    symbols: input.symbols,
    knowledge: input.knowledge,
    corpusKnows: input.corpusKnows,
    ...(input.topScore !== undefined ? { topScore: input.topScore } : {}),
    ...(input.agreement !== undefined ? { agreement: input.agreement } : {}),
  });

  // Shadow: detected, recorded, never enforced.
  void shadow.shouldReject();

  const allowed = new Set(input.context.evidence.map((evidence) => evidence.routeId as string));
  const wrongNavigation = [...input.answer.matchAll(/\[\[go:([^\]]{1,120})\]\]/g)]
    .map((match) => match[1].trim())
    .filter((routeId) => !allowed.has(routeId));

  const expectedSymbols = input.case.expected.symbols ?? [];
  const expectedFacets = input.case.expected.facets ?? [];
  const facetsById = new Map(
    input.context.evidence.flatMap((evidence) => evidence.facets.map((facet) => [facet.id, facet]))
  );
  const answerConcepts = queryConcepts(input.answer);
  const coveredFacets = expectedFacets.filter((id) => {
    const facet = facetsById.get(id);
    if (!facet) return false;
    const label = new Set(tokenize(facet.label));
    return answerConcepts.some((concept) => concept.variants.some((variant) => label.has(variant)));
  });
  const facetCoverage = expectedFacets.length === 0 ? null : coveredFacets.length / expectedFacets.length;

  return {
    answered: input.answer.trim().length > 0,
    audit,
    wrongNavigation,
    offeredNavigation: /\[\[go:/.test(input.answer),
    showedCode: /```/.test(input.answer),
    citesSource: /\[\d+\]/.test(input.answer),
    namesExpectedSymbol:
      expectedSymbols.length === 0
        ? null
        : expectedSymbols.some((id) => {
            const symbol = input.symbols.findById(id);
            return symbol ? input.answer.includes(symbol.name) : false;
          }),
    explanationCompleteness: facetCoverage === null ? null : facetCoverage * 0.65 + audit.grounding.coverage * 0.35,
    facetCoverage,
    specificity: answerSpecificity(input.answer),
    redundancy: answerRedundancy(input.answer),
    attribution: {
      knowledgeIds: input.context.evidence.map((evidence) => evidence.knowledgeId),
      chunkIds: input.context.evidence.map((evidence) => evidence.chunkId),
      symbolIds: input.context.symbols.map((entry) => entry.symbol.id),
      routeIds: [...new Set(input.context.evidence.map((evidence) => evidence.routeId as string))],
      contextTokens: input.context.budget.evidenceUsed + input.context.budget.reserved,
      retrievalReasons: [...new Set(input.context.evidence.map((evidence) => evidence.reason))],
    },
    characters: input.answer.length,
  };
}

export interface MeasuredCase {
  case: EvalCase;
  measurement: AnswerMeasurement;
  /** Shadow measurement of the model output before deterministic delivery. */
  rawMeasurement?: AnswerMeasurement;
  delivery?: "model" | "salvage" | "grounded-synthesis";
  latencyMs: number;
  tokensPerSecond: number | null;
  /**
   * Time to first token, which only a streaming host can observe — §PART 27.
   *
   * Absent for a headless run rather than zero: a browser answer that starts
   * after four seconds and a Node answer nobody timed are different facts, and
   * a zero would print as the better of the two.
   */
  ttftMs?: number;
  finish?: "stop" | "length" | "aborted";
  /** `true` only when the provider says the configured limit ended generation. */
  truncated?: boolean;
  retrievalTimings?: RetrievalReport["timings"];
}

/**
 * §PART 3: one row per behaviour, no single aggregate hiding any of them.
 *
 * The aggregate is what let "invented API: 0.0%" sit above a transcript that
 * fabricated a founder. Every line below is a different way an answer fails a
 * reader, and averaging them would recreate exactly that.
 */
export interface GenerationMetrics {
  cases: number;
  answered: number;

  fullyGrounded: number;
  partiallyGrounded: number;
  substantiallyUngrounded: number;
  /** Mean share of claims with evidence behind them. */
  groundingCoverage: number;

  inventedSymbol: number;
  /**
   * The two halves of an invented name, reported apart — §PART 3.
   *
   * `JIT.security.redact` and `.notEmpty()` fail a reader in different ways: a
   * namespace that does not exist is caught by the editor on the first
   * keystroke, and a plausible method on a real chain is not caught until it
   * runs. One row hid that difference.
   */
  inventedApi: number;
  inventedMethod: number;
  fabricatedEntity: number;
  fabricatedHistory: number;
  unsupportedClaim: number;
  foreignDomainDrift: number;
  wrongLanguage: number;
  degenerated: number;
  /** Share of outputs whose provider explicitly stopped at maxTokens. */
  /** Null when no response recorded an explicit finish reason. */
  truncated: number | null;

  wrongNavigation: number;
  /** Of the answers that offered a link at all, those whose links were real. */
  correctNavigation: number;
  /** How many answers offered navigation, since the rate above needs it. */
  offeredNavigation: number;
  /**
   * Of the answers that showed code, those with no invented name and no drift.
   *
   * The closest thing to "correct API usage" that is checkable without
   * executing the snippet: every name in it exists, and it is about jit.
   */
  usableCode: number;
  /** How many answers showed code at all. */
  showedCode: number;
  citesSource: number;
  /** Of cases expecting a named API, how often the answer names it. */
  symbolAccuracy: number;
  /** Answers a strict policy would have rejected. */
  wouldReject: number;

  averageClaims: number;
  averageCharacters: number;
  explanationCompleteness: number;
  facetCoverage: number;
  specificity: number;
  redundancy: number;
  medianLatencyMs: number;
  /** Null when the runtime could not observe it — never 0. */
  medianTtftMs: number | null;
  tokensPerSecond: number | null;
  queryEmbeddingMs: number;
  vectorScanMs: number;
  vectorTopKMs: number;

  byOrigin: Record<string, number>;
  /** Model outputs rejected before the safe delivery path was applied. */
  rawWouldReject: number;
  salvageUsed: number;
  groundedSynthesisUsed: number;
}

const has = (result: AuditResult, kind: FailureKind) => result.findings.some((finding) => finding.kind === kind);

/** Every name an invented-symbol finding objected to, across an answer. */
const offenders = (entry: MeasuredCase) =>
  entry.measurement.audit.findings
    .filter((finding) => finding.kind === "invented-symbol")
    .flatMap((finding) => finding.offenders);

export function measureGeneration(cases: readonly MeasuredCase[]): GenerationMetrics {
  const total = cases.length || 1;
  const share = (predicate: (entry: MeasuredCase) => boolean) => cases.filter(predicate).length / total;

  const withSymbol = cases.filter((entry) => entry.measurement.namesExpectedSymbol !== null);
  const offeredNavigation = cases.filter((entry) => entry.measurement.offeredNavigation);
  const showedCode = cases.filter((entry) => entry.measurement.showedCode);
  const latencies = cases.map((entry) => entry.latencyMs).sort((left, right) => left - right);
  const ttfts = cases
    .map((entry) => entry.ttftMs)
    .filter((value): value is number => typeof value === "number" && value > 0)
    .sort((left, right) => left - right);
  const explanations = cases.filter((entry) => entry.measurement.explanationCompleteness !== null);

  const byOrigin: Record<string, number> = {};
  for (const entry of cases) {
    for (const origin of entry.measurement.audit.classification.origins as FailureOrigin[]) {
      byOrigin[origin] = (byOrigin[origin] ?? 0) + 1;
    }
  }

  const verdict = (name: AuditResult["grounding"]["verdict"]) =>
    share((entry) => entry.measurement.audit.grounding.verdict === name);

  return {
    cases: cases.length,
    answered: cases.filter((entry) => entry.measurement.answered).length,

    fullyGrounded: verdict("fully-grounded"),
    partiallyGrounded: verdict("partially-grounded"),
    substantiallyUngrounded: verdict("substantially-ungrounded"),
    groundingCoverage: cases.reduce((sum, entry) => sum + entry.measurement.audit.grounding.coverage, 0) / total,

    inventedSymbol: share((entry) => has(entry.measurement.audit, "invented-symbol")),
    inventedApi: share((entry) => offenders(entry).some((name) => name.startsWith("JIT."))),
    inventedMethod: share((entry) => offenders(entry).some((name) => name.startsWith("."))),
    fabricatedEntity: share((entry) => has(entry.measurement.audit, "fabricated-entity")),
    fabricatedHistory: share((entry) => has(entry.measurement.audit, "fabricated-history")),
    unsupportedClaim: share((entry) => has(entry.measurement.audit, "unsupported-factual-claim")),
    foreignDomainDrift: share((entry) => has(entry.measurement.audit, "foreign-domain-drift")),
    wrongLanguage: share((entry) => has(entry.measurement.audit, "wrong-language")),
    degenerated: share((entry) => has(entry.measurement.audit, "generation-degeneration")),
    truncated: cases.some((entry) => entry.finish !== undefined) ? share((entry) => entry.truncated === true) : null,

    wrongNavigation: share((entry) => entry.measurement.wrongNavigation.length > 0),
    correctNavigation:
      offeredNavigation.length === 0
        ? 1
        : offeredNavigation.filter((entry) => entry.measurement.wrongNavigation.length === 0).length /
          offeredNavigation.length,
    offeredNavigation: offeredNavigation.length,
    usableCode:
      showedCode.length === 0
        ? 1
        : showedCode.filter(
            (entry) =>
              !has(entry.measurement.audit, "invented-symbol") && !has(entry.measurement.audit, "foreign-domain-drift")
          ).length / showedCode.length,
    showedCode: showedCode.length,
    citesSource: share((entry) => entry.measurement.citesSource),
    symbolAccuracy:
      withSymbol.length === 0
        ? 1
        : withSymbol.filter((entry) => entry.measurement.namesExpectedSymbol).length / withSymbol.length,
    wouldReject: share((entry) => new StrictAuditPolicy().shouldReject(entry.measurement.audit)),
    rawWouldReject: share((entry) =>
      entry.rawMeasurement ? new StrictAuditPolicy().shouldReject(entry.rawMeasurement.audit) : false
    ),
    salvageUsed: share((entry) => entry.delivery === "salvage"),
    groundedSynthesisUsed: share((entry) => entry.delivery === "grounded-synthesis"),

    averageClaims: cases.reduce((sum, entry) => sum + entry.measurement.audit.grounding.claims, 0) / total,
    averageCharacters: Math.round(cases.reduce((sum, entry) => sum + entry.measurement.characters, 0) / total),
    explanationCompleteness:
      explanations.length === 0
        ? 1
        : explanations.reduce((sum, entry) => sum + (entry.measurement.explanationCompleteness ?? 0), 0) /
          explanations.length,
    facetCoverage:
      explanations.length === 0
        ? 1
        : explanations.reduce((sum, entry) => sum + (entry.measurement.facetCoverage ?? 0), 0) / explanations.length,
    specificity: cases.reduce((sum, entry) => sum + entry.measurement.specificity, 0) / total,
    redundancy: cases.reduce((sum, entry) => sum + entry.measurement.redundancy, 0) / total,
    medianLatencyMs: Math.round(latencies[Math.floor(latencies.length / 2)] ?? 0),
    medianTtftMs: ttfts.length === 0 ? null : Math.round(ttfts[Math.floor(ttfts.length / 2)] ?? 0),
    tokensPerSecond: cases.some((entry) => entry.tokensPerSecond !== null)
      ? Math.round(
          (cases.reduce((sum, entry) => sum + (entry.tokensPerSecond ?? 0), 0) /
            cases.filter((entry) => entry.tokensPerSecond !== null).length) *
            10
        ) / 10
      : null,
    queryEmbeddingMs: cases.reduce((sum, entry) => sum + (entry.retrievalTimings?.queryEmbeddingMs ?? 0), 0) / total,
    vectorScanMs: cases.reduce((sum, entry) => sum + (entry.retrievalTimings?.vector?.vectorScanMs ?? 0), 0) / total,
    vectorTopKMs: cases.reduce((sum, entry) => sum + (entry.retrievalTimings?.vector?.topKSelectionMs ?? 0), 0) / total,
    byOrigin,
  };
}

function answerSpecificity(answer: string): number {
  const tokens = tokenize(answer);
  return tokens.length === 0 ? 0 : new Set(tokens).size / tokens.length;
}

function answerRedundancy(answer: string): number {
  const sentences = answer
    .replace(/```[\s\S]*?```/g, " ")
    .split(/(?<=[.!?])\s+|\n+/)
    .map((sentence) => new Set(tokenize(sentence)))
    .filter((tokens) => tokens.size > 2);
  let highest = 0;
  for (let left = 0; left < sentences.length; left += 1) {
    for (let right = left + 1; right < sentences.length; right += 1) {
      highest = Math.max(highest, overlap(sentences[left], sentences[right]));
    }
  }
  return highest;
}
