/**
 * Turning an answer into the claims it makes.
 *
 * The design constraint is stated in §PART 17 and it is the honest one: this
 * cannot prove a sentence true. What it can do is decide what *kind* of
 * assertion a sentence is, and whether anything the model was shown supports
 * it — which is enough to separate "paraphrased the documentation" from
 * "invented a founder".
 *
 * Everything here is pattern work over the answer plus lookups against the
 * evidence and the symbol index. No second model judges the first one: a judge
 * would be the single component of this system whose verdicts nothing could
 * check, and the whole architecture exists to avoid that.
 */
import type { ClaimKind, ClaimSeverity, GroundingClaim } from "../../core/entities/claim";
import type { ModelContext } from "../../core/entities/model-context";
import type { KnowledgeId } from "../../core/value-objects/ids";
import { fold, queryConcepts, tokenize } from "../retrieval/tokenizer";

/**
 * Words too common to count as evidence that two sentences say the same thing.
 *
 * Both languages, because an answer in Portuguese is checked against English
 * documentation and the shared vocabulary is exactly what must not count.
 */
const COMMON = new Set([
  "the",
  "and",
  "for",
  "with",
  "that",
  "this",
  "from",
  "into",
  "you",
  "your",
  "its",
  "are",
  "was",
  "can",
  "not",
  "que",
  "para",
  "com",
  "uma",
  "dos",
  "das",
  "por",
  "mais",
  "como",
  "isso",
  "seu",
  "sua",
  "ele",
  "ela",
  "foi",
  "jit",
  "schema",
  "code",
  "value",
  "data",
  "type",
  "function",
  "usar",
  "codigo",
  "dados",
  "voce",
]);

function contentWords(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^\p{L}\p{N}.]+/u)
    .map((word) => fold(word.replace(/\.$/, "")))
    .filter((word) => word.length > 3 && !COMMON.has(word));
}

interface ContentConcept {
  literal: string;
  variants: string[];
}

/**
 * A reader may answer in Portuguese from English evidence. Each reader word
 * is therefore compared through the same literal/synonym/stem expansion used
 * by retrieval. The denominator remains the number of reader concepts: an
 * expansion improves recall without making one word count six times.
 */
function contentConcepts(text: string): ContentConcept[] {
  return queryConcepts(text).filter((concept) => concept.literal.length > 3 && !COMMON.has(fold(concept.literal)));
}

/**
 * A claim about who made the library, when, or why.
 *
 * The highest-severity kind, and the one with the clearest signature. A model
 * with no evidence about a library's origins does not decline to describe them
 * — it produces a founder, a year and a motivation, because that is the shape
 * of the text it was trained on. Nothing downstream catches it: the names are
 * not API names, so no symbol check fires, and the prose is fluent.
 *
 * Both languages, because the failure appeared in Portuguese first.
 */
const HISTORY_PATTERNS: RegExp[] = [
  /\b(created|written|developed|founded|designed|built|invented|launched|started)\s+by\b/i,
  /\b(creator|author|founder|inventor|maintainer)s?\s+(of|is|was|are)\b/i,
  /\b(introduced|released|launched|created|founded)\s+in\s+\d{4}\b/i,
  /\b(criad[ao]|desenvolvid[ao]|escrit[ao]|fundad[ao]|projetad[ao])\s+(por|pel[ao])\b/i,
  /\b(criador|autor|fundador|inventor)(es|a)?\s+(d[aeo]|é|foi)\b/i,
  /\b(lan[çc]ad[ao]|criad[ao]|surgiu|nasceu)\s+em\s+\d{4}\b/i,
];

/**
 * A capitalised name that is not a sentence opener and not one of ours.
 *
 * Deliberately not a named-entity recogniser. §PART 15 asks for the patterns
 * that actually appeared, generalised — and what appeared was a two-word
 * proper noun in subject position. `JIT`, `TypeScript` and the API surface are
 * excluded by name because they are the vocabulary the documentation itself
 * uses; anything else capitalised mid-sentence is a name the answer
 * introduced.
 */
const PROPER_NOUN = /\b([A-Z][a-z]{2,}(?:\s+[A-Z][a-z]{2,})*)\b/g;

/** Names the documentation legitimately uses, so they are never "introduced". */
const OURS = new Set([
  "jit",
  "typescript",
  "javascript",
  "json",
  "node",
  "nodejs",
  "deno",
  "bun",
  "npm",
  "pnpm",
  "yarn",
  "chrome",
  "firefox",
  "safari",
  "webgpu",
  "csp",
  "aot",
  "cqrs",
  "dto",
  "ddd",
  "uuid",
  "ndjson",
  "csv",
  "zod",
  "valibot",
  "typebox",
  "typia",
  "ajv",
  "vercel",
  "next",
  "react",
  "vite",
  "esbuild",
  "rust",
  "wasm",
]);

/** Figures a reader would act on: timings, sizes and multipliers. */
const FIGURE = /\b\d+(?:[.,]\d+)?\s?(?:ns|µs|us|ms|s|x|%|KB|MB|GB|GiB|MiB)\b/gi;

/** A sentence stating how the library works or what it supports. */
const TECHNICAL =
  /\b(compil|gener|valid|allocat|aloc|cache|parse|runtime|memori|thread|interpret|serial|infer|emit|optimi[sz]|otimiz|execut|propriet|propried|chamad|caminh|lat[êe]nc|redund|shape|hot[- ]path|constru|process|busc|acess|funcion|desempenh)/i;

const BEHAVIOUR =
  /\b(supports?|does not support|requires?|stores?|uses?|works with|integrates?|runs?|reads?|creates?|avoids?|keeps?|preserves?|suporta|requer|armazena|utiliza|execut|l[eê]|cri|evit|mant[ée]m|preserva|constru|process|busc|acess)\b/i;

export interface ClaimAnalysis {
  claims: GroundingClaim[];
  /** Share of claims with evidence behind them. */
  coverage: number;
  fatalUnsupported: number;
  unsupported: number;
}

export interface ClaimInput {
  answer: string;
  context: ModelContext;
  /** Whether a name exists in the library's surface. */
  hasSymbol: (name: string) => boolean;
  /** Whether the whole corpus uses a word anywhere. */
  corpusKnows: (term: string) => boolean;
}

/** Below this share of shared content words, a sentence is not a paraphrase. */
const PARAPHRASE = 0.45;

export function analyseClaims(input: ClaimInput): ClaimAnalysis {
  /** Keep passages distinct even when several chunks share one knowledge id. */
  const evidenceWords: { id: KnowledgeId; vocabulary: Set<string> }[] = [];
  for (const evidence of input.context.evidence) {
    evidenceWords.push({
      id: evidence.knowledgeId,
      vocabulary: new Set([...contentWords(evidence.content), ...tokenize(evidence.content)]),
    });
  }

  const allEvidence = new Set<string>();
  for (const { vocabulary } of evidenceWords) for (const word of vocabulary) allEvidence.add(word);

  const figuresInEvidence = new Set(
    input.context.evidence
      .flatMap((evidence) => [...evidence.content.matchAll(FIGURE)])
      .map((match) => normalizeFigure(match[0]))
  );

  const claims: GroundingClaim[] = [];

  for (const raw of splitSentences(input.answer)) {
    const sentence = raw.trim();
    if (sentence.length < 25 || sentence.startsWith("```")) continue;

    const concepts = contentConcepts(sentence);
    const words = concepts.map((concept) => concept.literal);
    if (concepts.length < 3) continue;

    /**
     * Which passages support this sentence, by shared vocabulary.
     *
     * Recorded per passage rather than as a boolean, because §PART 10 needs to
     * distinguish "the model invented it" from "the context already said it" —
     * and that is only answerable if a claim names the evidence it leaned on.
     */
    const supporting: KnowledgeId[] = [];
    for (const { id, vocabulary } of evidenceWords) {
      const shared = concepts.filter((concept) => concept.variants.some((variant) => vocabulary.has(variant))).length;
      if (shared / concepts.length >= PARAPHRASE) supporting.push(id);
    }

    for (const claim of classify(sentence, words, input, figuresInEvidence, allEvidence)) {
      claims.push({
        ...claim,
        evidenceIds: supporting,
        // An api claim is supported by the symbol index, not by vocabulary
        // overlap: a real name is real whether or not a retrieved passage
        // happened to mention it.
        supported: claim.kind === "api" ? claim.supported : claim.supported && supporting.length > 0,
      });
    }
  }

  const unsupported = claims.filter((claim) => !claim.supported);

  return {
    claims,
    coverage: claims.length === 0 ? 1 : (claims.length - unsupported.length) / claims.length,
    unsupported: unsupported.length,
    fatalUnsupported: unsupported.filter((claim) => claim.severity === "fatal").length,
  };
}

type PartialClaim = Omit<GroundingClaim, "evidenceIds">;

/**
 * What a sentence claims, which may be more than one thing.
 *
 * "JIT foi criada por Ajit Jain em 2022 para acelerar validação" is a
 * historical claim, an entity claim and a technical one at once, and each is
 * checked against a different thing. Returning a list rather than a single
 * kind is what lets the fatal half be caught when the technical half happens
 * to paraphrase a retrieved passage.
 */
function classify(
  sentence: string,
  words: string[],
  input: ClaimInput,
  figuresInEvidence: ReadonlySet<string>,
  allEvidence: ReadonlySet<string>
): PartialClaim[] {
  const found: PartialClaim[] = [];
  const make = (kind: ClaimKind, severity: ClaimSeverity, supported: boolean, subjects: string[]) =>
    found.push({ text: trim(sentence), kind, severity, supported, subjects });

  // ------------------------------------------------------------- history
  if (HISTORY_PATTERNS.some((pattern) => pattern.test(sentence))) {
    /**
     * A history claim is supported only by evidence that talks about history.
     *
     * Vocabulary overlap is not enough here: "JIT foi criada por X para
     * acelerar a validação" shares `validação` with half the corpus, and that
     * is exactly the coincidence that let the fabrication through. The
     * documentation contains no origin story at all, so the honest rule is
     * that any such claim is unsupported unless the evidence itself uses the
     * vocabulary of authorship.
     */
    const evidenceHasHistory = input.context.evidence.some((evidence) =>
      HISTORY_PATTERNS.some((pattern) => pattern.test(evidence.content))
    );

    make("historical", "fatal", evidenceHasHistory, [sentence.slice(0, 60)]);
  }

  // -------------------------------------------------------------- entity
  const introduced = properNouns(sentence).filter(
    (name) => !allEvidence.has(fold(name.split(/\s+/)[0].toLowerCase())) && !input.corpusKnows(fold(name.toLowerCase()))
  );

  if (introduced.length > 0) make("entity", "fatal", false, introduced);

  // ------------------------------------------------------------ numeric
  const figures = [...sentence.matchAll(FIGURE)].map((match) => match[0].trim());
  const unsupportedFigures = figures.filter((figure) => !figuresInEvidence.has(normalizeFigure(figure)));
  if (figures.length > 0) make("numeric", "warning", unsupportedFigures.length === 0, unsupportedFigures);

  // ---------------------------------------------------------------- api
  const names = [...sentence.matchAll(/\bJIT\.([A-Za-z_$][\w$.]*)/g)].map((match) => `JIT.${match[1]}`);
  const invented = names.filter((name) => !input.hasSymbol(name));
  if (names.length > 0) make("api", "fatal", invented.length === 0, invented);

  // ----------------------------------------------------------- behaviour
  if (BEHAVIOUR.test(sentence)) make("behavior", "warning", true, []);

  // ----------------------------------------------------------- technical
  if (found.length === 0 && TECHNICAL.test(sentence) && words.length >= 4) {
    make("technical", "warning", true, []);
  }

  return found;
}

function properNouns(sentence: string): string[] {
  const found: string[] = [];

  for (const match of sentence.matchAll(PROPER_NOUN)) {
    // A capital at the start of a sentence says nothing about the word.
    if (match.index === 0) continue;
    // Nor does one after a full stop, a newline or an opening quote.
    if (/[.!?\n"'`([]\s*$/.test(sentence.slice(0, match.index))) continue;

    const name = match[1];
    if (OURS.has(name.toLowerCase())) continue;
    // A single capitalised word is usually a heading fragment or a product we
    // do know; two or more is a person or an organisation.
    if (!name.includes(" ")) continue;

    found.push(name);
  }

  return found;
}

function splitSentences(answer: string): string[] {
  // Code is the symbol validators' business, not prose's.
  return answer.replace(/```[\s\S]*?```/g, " ").split(/(?<=[.!?])\s+|\n+/);
}

function normalizeFigure(figure: string): string {
  return figure.toLowerCase().replace(/\s+/g, "").replace(",", ".");
}

function trim(sentence: string): string {
  return sentence.length > 140 ? `${sentence.slice(0, 139)}…` : sentence;
}
