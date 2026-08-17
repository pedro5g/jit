import { type ConceptMatch, conceptById, resolveConcepts, SELF_NODE } from "./graph";
import { resolveSolutions, type Solution } from "./solutions";
import type { ApiMember } from "./types";

/**
 * What the ghost works out about a question before it retrieves anything.
 *
 * The model is small and gets one shot at the prompt, so every decision that
 * can be made without it is made here: which language to answer in, what the
 * question is actually about, whether it continues the last one or opens a new
 * subject, whether the answer lives somewhere else on the site. Each of these
 * used to be left to the model, and each was a way for it to go wrong.
 */

export type Intent =
  /** "what is X", "why is it fast" — wants an explanation. */
  | "concept"
  /** "how do I X", "write me X" — wants steps or code. */
  | "howto"
  /** names an API and wants its contract. */
  | "api"
  /** "vs zod", "which is faster" — wants a comparison. */
  | "compare"
  /** "why does X throw", "it does not work" — wants a fix. */
  | "troubleshoot";

export interface Understanding {
  /** The question itself, so a follow-up can carry it forward. */
  question: string;
  /**
   * What retrieval should search for. Usually the question; for a follow-up
   * with no subject of its own, the previous question is prepended so the
   * search has something to match.
   */
  retrievalQuery: string;
  language: "pt" | "en";
  intent: Intent;
  /** Concepts the question is about, strongest first. */
  concepts: ConceptMatch[];
  /** Public API members named in the question. */
  apis: string[];
  /** The question is about jit itself, not the technique that shares its name. */
  aboutTheLibrary: boolean;
  /** It continues the previous exchange rather than opening a new subject. */
  continuation: boolean;
  /**
   * The question is about a version, a release or a migration, so the
   * changelog and the migration guide are the answer rather than a distraction.
   */
  wantsHistory: boolean;
  /**
   * The reader asked to be taken somewhere, rather than asked a question that
   * happens to have a page behind it. Navigating unasked interrupts whatever
   * they were reading, so this is what gates it.
   */
  asksToNavigate: boolean;
  /** The answer lives on a page the reader is not on. */
  shouldNavigate: boolean;
  /** Where the graph would send them, when it has an opinion. */
  suggestedPage?: string | undefined;
  /**
   * Recipes whose symptoms this question shows. Retrieval finds pages about
   * the library; these are about the reader's problem, which is a different
   * question and usually the one actually being asked.
   */
  solutions: Solution[];
  /**
   * Pages the ghost may point at without navigating — the concept pages one
   * edge out from what the question is about. This is the symbolic link
   * between related nodes: `security` reaches `boundary`, `query` reaches
   * `lazy` and `binary`, so an answer can end with somewhere useful to go
   * next instead of only where it came from.
   */
  relatedPages: string[];
}

/** Portuguese function words that never appear in an English question. */
const PT_MARKERS =
  /\b(como|porque|por que|pq|qual|quais|quando|onde|quem|preciso|posso|pode|podem|poderia|fazer|faço|usar|uso|meu|minha|isso|esse|essa|não|nao|também|tambem|então|entao|para|pra|com|sem|sobre|mais|muito|melhor|ajuda|ajudar|escrever|criar|gerar|rodar|tem|está|esta|ser|seu|sua|mostrar|mostra|exemplo|exemplos|um|uma|dos|das|entre|sobre|serve|funciona)\b/i;

/** Words that settle it the other way, so "um" in an English sentence cannot. */
const EN_MARKERS =
  /\b(the|is|are|does|do|how|what|why|when|which|show|me|can|could|should|would|write|make|give|about|between)\b/i;

const HOWTO =
  /\b(how|como|write|escrev|creat|cria|build|constru|generat|ger|make|faz|show|mostr|use|usar|set up|configur)/i;
const COMPARE = /\b(vs|versus|compar|melhor que|better than|instead of|em vez|difference|diferen)/i;
// "pq o ..." is how half of Portuguese questions open, including "pq o jit é
// rápido" — it belongs to the failure patterns only alongside one of them.
const TROUBLESHOOT =
  /\b(error|erro|fail|falh|throw|lança|broken|quebr|does ?n[o']?t|não funciona|nao funciona|why does|bug|wrong|errado)/i;
const CONCEPT = /\b(what|o que|why|por que|porque|pq|quando usar|when should|explain|explic)/i;

/**
 * Questions the changelog and the migration guide are the right answer to.
 * Everywhere else they outrank the pages that explain how the library behaves
 * today, which is how "why is jit fast" got answered out of release notes.
 */
const HISTORY =
  /\b(\d+\.(?:\d+|x)|chang(?:ed|es|elog)|mudou|mudan|novidade|what'?s new|release|version|vers[ãa]o|breaking|migrat|migra|remov|deprecat|upgrade|atualiz)/i;

/**
 * An actual request to go somewhere, as opposed to a question that merely has
 * a page behind it. Every question has a page behind it; almost none of them
 * are asking to leave the one being read.
 */
const NAVIGATE =
  /\b(me leva|leve-me|me mostra a p[áa]gina|abre? a (?:p[áa]gina|doc|se[çc][ãa]o)|abrir a (?:p[áa]gina|doc)|onde (?:fica|est[áa]|encontro|vejo)|ir para|v[áa] para|take me|open the (?:page|docs?|section)|go to the|show me the (?:page|docs?|section)|where (?:is|can i find|do i find)|link (?:para|to|da|de))\b/i;

/** Words that only make sense against something already said. */
const ANAPHORA =
  /\b(isso|esse|essa|isto|ele|ela|dele|dela|aquilo|mesmo|it|this|that|these|those|there|instead|also|e se|and if|então|entao)\b/i;

/**
 * Which language the question is in, or null when nothing in it says.
 *
 * Kept separate from `detectLanguage` because a follow-up often carries no
 * signal at all and the right answer is then "the same as last time" rather
 * than a guess. "pode me mostrar um exemplo de uso?" has no accent, and an
 * answer in English to a Portuguese reader is its own kind of wrong.
 */
function languageSignal(question: string): "pt" | "en" | null {
  if (/[ãõçáéíóúâêôàü]/i.test(question)) return "pt";

  const portuguese = PT_MARKERS.test(question);
  const english = EN_MARKERS.test(question);

  if (portuguese && !english) return "pt";
  if (english && !portuguese) return "en";

  return null;
}

export function detectLanguage(question: string): "pt" | "en" {
  return languageSignal(question) ?? "en";
}

export function classifyIntent(question: string, apis: string[]): Intent {
  if (COMPARE.test(question)) return "compare";
  if (TROUBLESHOOT.test(question)) return "troubleshoot";
  // An explanatory opener settles it before the how-to words do: "why is the
  // generated code fast" contains "generat", which otherwise reads as a
  // request to generate something.
  if (CONCEPT.test(question)) return "concept";
  if (HOWTO.test(question)) return "howto";
  return apis.length > 0 ? "api" : "concept";
}

/** `JIT.validate`, `safeParse`, `jsonSchema` — names the reader typed. */
export function mentionedApis(question: string, api: ApiMember[]): string[] {
  if (api.length === 0) return [];

  const found = new Set<string>();
  for (const member of api) {
    // `JIT.x` is unambiguous. Bare, only a camelCase name counts: `jsonSchema`
    // can only be the API, while `object`, `map` and `string` are words a
    // reader uses in an ordinary sentence about anything.
    if (new RegExp(`\\bJIT\\.${member.name}\\b`, "i").test(question)) found.add(member.name);
    else if (/[A-Z]/.test(member.name) && new RegExp(`\\b${member.name}\\b`).test(question)) found.add(member.name);
  }

  return [...found];
}

/**
 * Whether this question belongs with the previous one.
 *
 * A reader who switches from "how do I mask PII" to "why is jit fast" gets a
 * worse answer if the first exchange is still in the prompt: a small model
 * keeps answering the old question. Sharing a concept, or leaning on a word
 * like "isso" that has no meaning alone, is what makes it a continuation.
 */
export function isContinuation(concepts: ConceptMatch[], previous: Understanding | null, question: string): boolean {
  if (!previous) return false;
  if (ANAPHORA.test(question)) return true;

  // A question with no subject of its own is asking about the last one.
  //
  // "pode me mostrar um exemplo de uso?" names nothing: no concept matches, so
  // retrieval returned literally zero sections and the model was asked to show
  // an example of nothing at all. It answered with a JSON envelope and a
  // hundred lines of `array.push(...)`, which is what a small model does when
  // it is handed a question and no evidence. An example of *what* is in the
  // exchange immediately before it.
  if (!concepts.some((match) => match.weight === 1 && match.id !== SELF_NODE)) return true;

  // Only concepts the reader named count. An edge neighbour is a weak
  // association — nearly every question inherits `validation` from something —
  // and counting those makes every question look like a continuation, which
  // defeats the point of dropping stale context.
  const before = new Set(previous.concepts.filter((match) => match.weight === 1).map((match) => match.id));
  return concepts.some((match) => match.weight === 1 && match.id !== SELF_NODE && before.has(match.id));
}

/**
 * The page the graph would send a reader to, when the question is squarely
 * about one concept. Retrieval decides the section; this decides whether
 * navigating is the right move at all.
 */
function suggestedPageFor(concepts: ConceptMatch[]): string | undefined {
  const strongest = concepts.find((match) => match.weight === 1 && match.id !== SELF_NODE);
  return strongest ? conceptById(strongest.id)?.page : undefined;
}

/**
 * Every page behind a concept the reader named directly. These are handed to
 * retrieval as a preference: the graph recognised the subject from the words
 * in the question, which is evidence BM25 does not have when the question and
 * the documentation are in different languages.
 */
export function conceptPages(concepts: ConceptMatch[]): string[] {
  const pages = new Set<string>();

  for (const match of concepts) {
    if (match.weight !== 1 || match.id === SELF_NODE) continue;
    const page = conceptById(match.id)?.page;
    if (page?.startsWith("/docs")) pages.add(page);
  }

  return [...pages];
}

/**
 * The pages one edge out from what the question is about.
 *
 * The concept graph already records which ideas belong together — masking
 * belongs with the boundary it happens at, a query with the lazy and binary
 * backends behind it — and that relationship is exactly the "see also" a
 * reader wants at the end of an answer. Reading it off the edges means the
 * links are derived from the same structure that decides what a question is
 * about, so they cannot point somewhere unrelated.
 */
export function relatedPagesFor(concepts: ConceptMatch[]): string[] {
  const direct = new Set(concepts.filter((match) => match.weight === 1).map((match) => match.id));
  const pages = new Set<string>();

  for (const id of direct) {
    for (const neighbour of Object.keys(conceptById(id)?.edges ?? {})) {
      if (direct.has(neighbour) || neighbour === SELF_NODE) continue;
      const page = conceptById(neighbour)?.page;
      if (page?.startsWith("/docs")) pages.add(page);
    }
  }

  return [...pages].slice(0, 3);
}

export function understand(
  question: string,
  options: { api: ApiMember[]; currentUrl: string; previous: Understanding | null }
): Understanding {
  const own = resolveConcepts(question);
  const apis = mentionedApis(question, options.api);

  /**
   * A follow-up inherits the subject it is following up on.
   *
   * "pode me mostrar um exemplo de uso?" resolves to nothing, so on its own it
   * retrieves nothing and the model is asked to demonstrate an unnamed
   * library. Carrying the previous question's concepts forward is what makes
   * it a question about *that* — and it costs nothing when the reader really
   * has changed subject, because then they named the new one.
   */
  const inherited =
    !own.some((match) => match.weight === 1 && match.id !== SELF_NODE) && options.previous
      ? options.previous.concepts
      : [];

  const concepts = inherited.length > 0 ? inherited : own;
  const suggestedPage = suggestedPageFor(concepts);
  const currentPage = options.currentUrl.split("#")[0];

  /**
   * What retrieval searches for. A subjectless follow-up carries the previous
   * question's words too: "exemplo de uso" matches nothing in an English
   * index, while "pq a jit é rápida exemplo de uso" finds the page the
   * example should come from.
   */
  const retrievalQuery =
    inherited.length > 0 && options.previous ? `${options.previous.question} ${question}` : question;

  // A reader does not switch language between two messages. When the follow-up
  // carries no signal of its own, the previous turn decides.
  const language = languageSignal(question) ?? options.previous?.language ?? "en";

  return {
    question,
    retrievalQuery,
    language,
    intent: classifyIntent(question, apis),
    concepts,
    apis,
    // Every question typed into this panel is about this library — the reader
    // is standing in its documentation. Waiting for them to type the word
    // "jit" is what left the identity anchor off most prompts, and a small
    // model with no anchor answers about just-in-time compilation in general.
    aboutTheLibrary: true,
    continuation: isContinuation(own, options.previous, question),
    wantsHistory: HISTORY.test(question) || concepts.some((match) => match.weight === 1 && match.id === "migration"),
    asksToNavigate: NAVIGATE.test(question),
    solutions: resolveSolutions(question),
    relatedPages: relatedPagesFor(concepts),
    // already there: pointing is the useful move, not navigating
    shouldNavigate: Boolean(suggestedPage) && suggestedPage !== currentPage,
    suggestedPage,
  };
}

/**
 * The verified sentences behind the concepts a question is squarely about.
 *
 * These are ground truth, not retrieval: the section that ranks highest for
 * "why is jit fast" lists mechanisms, and a small model handed a list of
 * mechanisms explains none of them. Only directly-named concepts qualify — a
 * fact reached through an edge is a guess about relevance.
 */
export function groundTruth(concepts: ConceptMatch[]): string[] {
  return concepts
    .filter((match) => match.weight === 1)
    .map((match) => conceptById(match.id)?.fact)
    .filter((fact): fact is string => Boolean(fact))
    .slice(0, 3);
}

/**
 * The strategies behind the facts, for a question that asks how or why.
 *
 * A reader evaluating the library wants the mechanism, not a claim: "static
 * property access, checks ordered cheapest-first, no closures" is an answer,
 * "it is fast because it compiles" is a slogan. Held to one concept so the
 * detail stays about what was asked.
 */
export function mechanisms(concepts: ConceptMatch[], intent: Intent): string[] {
  if (intent !== "concept" && intent !== "api" && intent !== "compare") return [];

  const named = concepts.find((match) => match.weight === 1 && conceptById(match.id)?.mechanisms);
  return named ? (conceptById(named.id)?.mechanisms ?? []) : [];
}

/**
 * The extra terms a question earns from the graph, weighted by how strongly
 * the concept was matched. These ride alongside the literal terms rather than
 * replacing them: an exact identifier must still outrank a concept guess.
 */
export function conceptTerms(concepts: ConceptMatch[]): { term: string; weight: number }[] {
  const terms: { term: string; weight: number }[] = [];

  for (const match of concepts) {
    const node = conceptById(match.id);
    if (!node) continue;

    for (const term of node.terms) terms.push({ term, weight: match.weight });
    for (const api of node.apis) terms.push({ term: api.toLowerCase(), weight: match.weight * 0.8 });
  }

  return terms;
}
