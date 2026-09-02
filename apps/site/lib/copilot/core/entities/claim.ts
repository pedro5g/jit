import type { KnowledgeId } from "../value-objects/ids";

/**
 * An answer, decomposed into the things it asserts.
 *
 * The previous grounding check counted sentences: three unsupported ones made
 * an answer bad, two made it acceptable. A benchmark transcript killed that
 * idea in one line — the light model wrote "Ajit Jain, o criador da JIT,
 * desenvolveu uma estrutura de código interativo", which is a fabricated
 * person, a fabricated authorship and a fabricated history in a single
 * sentence, and scored one. Counting is the wrong axis: what matters is what
 * kind of thing is being claimed and whether anything supports it.
 *
 * So an answer becomes claims, each claim is looked up against the evidence it
 * was given, and severity comes from the *kind* rather than the quantity. One
 * invented origin story is fatal; three vague paraphrases are a warning.
 */

/**
 * What sort of assertion a sentence makes.
 *
 * The kinds are not a taxonomy of grammar — they are a taxonomy of *how a
 * reader gets hurt*. A wrong number goes into a slide. A wrong API name goes
 * into an editor. A wrong origin story gets repeated in a meeting, and there
 * is no compiler that catches it.
 */
export type ClaimKind =
  /** How the library behaves or is built: "compiles the schema once". */
  | "technical"
  /** Who made it, when, and why: creators, dates, origins, motivations. */
  | "historical"
  /** A named person, company, project or product. */
  | "entity"
  /** A figure a reader would act on: timings, sizes, multipliers. */
  | "numeric"
  /** A name from the library's own surface. */
  | "api"
  /** What the library does or does not support. */
  | "behavior";

export type ClaimSeverity = "info" | "warning" | "fatal";

export interface GroundingClaim {
  text: string;
  kind: ClaimKind;
  /** Passages that support it. Empty means nothing in the context did. */
  evidenceIds: KnowledgeId[];
  supported: boolean;
  severity: ClaimSeverity;
  /** The specific words that made it a claim, for the finding's detail. */
  subjects: string[];
}

/**
 * How an answer went wrong, in terms a report can group by.
 *
 * `fully-grounded` sits in the same union deliberately. An answer that is
 * entirely supported is a classification too, and having it here means the
 * benchmark reports one distribution rather than a failure count next to a
 * separately-computed success rate that may not agree with it.
 */
export type FailureKind =
  | "invented-symbol"
  | "unsupported-factual-claim"
  | "fabricated-entity"
  | "fabricated-history"
  | "foreign-domain-drift"
  | "wrong-language"
  | "generation-degeneration"
  | "invalid-example"
  | "substantially-ungrounded"
  | "missing-source-citation"
  | "fully-grounded";

/**
 * Where in the pipeline the failure actually happened.
 *
 * The distinction the benchmark exists to make. "The answer was wrong" is not
 * actionable; "retrieval never returned the page" and "retrieval returned it,
 * the context kept it, and the model wrote something else" lead to completely
 * different work — and only the second is a reason to want a larger model.
 */
export type FailureOrigin =
  /** The evidence was never found. */
  | "retrieval_failure"
  /** It was found and then dropped, or crowded out, before the model saw it. */
  | "context_failure"
  /** The evidence was present and correct; the model wrote something else. */
  | "model_failure"
  /** The answer asserts things the evidence does not support. */
  | "grounding_failure"
  /** The answer is in the wrong language. */
  | "language_failure"
  /** The generation came apart: a loop, an envelope, a truncation. */
  | "generation_failure";

/** One answer's complete classification. A single answer may carry several. */
export interface FailureClassification {
  kinds: FailureKind[];
  origins: FailureOrigin[];
  /** What the classification was based on, for a reader checking the call. */
  evidence: string[];
}
