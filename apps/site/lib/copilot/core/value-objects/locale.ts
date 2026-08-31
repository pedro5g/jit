/**
 * Language, kept separate from identity.
 *
 * A concept has one id and may have several translations; the translation a
 * reader gets is a rendering decision, not a different piece of knowledge.
 * Conflating the two is how a bilingual index ends up with two `uuid` concepts
 * that never rank together and never link to each other.
 *
 * Three distinct things travel under the word "locale", and the engine has to
 * keep them apart:
 *
 *   the source locale   — what language a document was written in;
 *   the reply locale    — what language the reader asked in, so what they get;
 *   the route locale    — what the URL should say.
 *
 * They are frequently different on the same request. A Portuguese question
 * about UUIDs retrieves English sources and is answered in Portuguese, and the
 * route it cites is whichever one exists.
 */

export const LOCALES = ["en", "pt-BR"] as const;

export type Locale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: Locale = "en";

export function isLocale(value: string): value is Locale {
  return (LOCALES as readonly string[]).includes(value);
}

export function parseLocale(value: string | null | undefined): Locale {
  return value && isLocale(value) ? value : DEFAULT_LOCALE;
}

/**
 * Which language a question was asked in.
 *
 * Deliberately not a language-detection library. The decision is binary, the
 * two candidates are far apart, and the questions are short and full of
 * identifiers — `JIT.string().uuid()` is the same in both languages, so a
 * general-purpose detector reading character n-grams gets short questions
 * wrong in exactly the case that matters.
 *
 * What separates them reliably is function words. "como faço para validar um
 * uuid" has four of them; "how do I validate a uuid" has four of the other
 * kind. Accents and the enclitic hyphen settle the rest.
 */
const PORTUGUESE_MARKERS = new Set([
  "a",
  "as",
  "ao",
  "aos",
  "com",
  "como",
  "da",
  "das",
  "de",
  "do",
  "dos",
  "e",
  "em",
  "ela",
  "ele",
  "eles",
  "essa",
  "esse",
  "esta",
  "este",
  "eu",
  "faco",
  "faz",
  "fazer",
  "isso",
  "ja",
  "mais",
  "mas",
  "meu",
  "minha",
  "muito",
  "na",
  "nao",
  "nas",
  "no",
  "nos",
  "num",
  "numa",
  "o",
  "os",
  "ou",
  "para",
  "pela",
  "pelo",
  "por",
  "porque",
  "posso",
  "pra",
  "pq",
  "qual",
  "quais",
  "quando",
  "que",
  "quero",
  "se",
  "sem",
  "ser",
  "seu",
  "sua",
  "sobre",
  "tem",
  "ter",
  "tipo",
  "todos",
  "uma",
  "usar",
  "usando",
  "vai",
  "voce",
  "ate",
  "onde",
  "entao",
  "melhor",
  "preciso",
  "consigo",
  "existe",
  "funciona",
  "diferenca",
  "exemplo",
  "erro",
  "campo",
  "arquivo",
  "valor",
  "chave",
  "objeto",
]);

const ENGLISH_MARKERS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "but",
  "by",
  "can",
  "do",
  "does",
  "for",
  "from",
  "get",
  "has",
  "have",
  "how",
  "i",
  "if",
  "in",
  "into",
  "is",
  "it",
  "its",
  "of",
  "on",
  "or",
  "should",
  "the",
  "their",
  "there",
  "this",
  "to",
  "use",
  "using",
  "want",
  "was",
  "what",
  "when",
  "where",
  "which",
  "why",
  "will",
  "with",
  "you",
  "your",
  "between",
  "difference",
  "example",
  "error",
  "field",
  "file",
  "value",
  "key",
  "object",
  "works",
  "instead",
]);

/**
 * Words that belong to both lists and therefore decide nothing.
 *
 * `a`, `do`, `e`, `no`, `os`, `se` are common English words and common
 * Portuguese ones. Counting them adds noise proportional to question length,
 * which is worst on the long questions where the signal should be strongest.
 */
const AMBIGUOUS = new Set([...PORTUGUESE_MARKERS].filter((word) => ENGLISH_MARKERS.has(word)));

export function detectLocale(question: string, fallback: Locale = DEFAULT_LOCALE): Locale {
  const normalized = question.toLowerCase();

  // ç, ã, õ and the enclitic pronoun have no English counterpart. One is
  // conclusive, so it short-circuits the count.
  if (/[çãõáéíóúâêô]/.test(normalized) || /\b\w+-(se|lo|la|los|las)\b/.test(normalized)) return "pt-BR";

  const words = normalized
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .split(/[^a-z0-9]+/)
    .filter(Boolean);

  let portuguese = 0;
  let english = 0;
  for (const word of words) {
    if (AMBIGUOUS.has(word)) continue;
    if (PORTUGUESE_MARKERS.has(word)) portuguese += 1;
    else if (ENGLISH_MARKERS.has(word)) english += 1;
  }

  if (portuguese === english) return fallback;
  return portuguese > english ? "pt-BR" : "en";
}
