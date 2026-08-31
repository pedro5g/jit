import { SYNONYMS } from "../../config/synonyms";

/**
 * Tokenizer shared by the index builder and the query path. Both sides must
 * agree exactly, so it lives in one file and has no options.
 *
 * Documentation about an API is mostly identifiers, so the rules that matter
 * are the ones about them: a dotted path yields its parts *and* the whole
 * path, and a camelCase name yields its words *and* the whole name. Asking
 * "how do I safeParse?" must reach a section that only ever wrote
 * `JIT.validate.safeParse`.
 */

// Held deaccented, because that is the only form `push` ever tests: "não" and
// "nao" are one word to a reader and must be one word here.
const STOPWORDS = new Set(
  [
    // English
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
    "me",
    "my",
    "not",
    "of",
    "on",
    "or",
    "s",
    "so",
    "than",
    "that",
    "the",
    "their",
    "them",
    "then",
    "there",
    "these",
    "they",
    "this",
    "to",
    "use",
    "using",
    "want",
    "was",
    "we",
    "what",
    "when",
    "where",
    "which",
    "why",
    "will",
    "with",
    "you",
    "your",
    // Portuguese — readers ask in it, and the docs are in English
    "aos",
    "com",
    "como",
    "da",
    "das",
    "de",
    "do",
    "dos",
    "e",
    "ele",
    "em",
    "eu",
    "faco",
    "faço",
    "faz",
    "fazer",
    "isso",
    "já",
    "mais",
    "mas",
    "me",
    "meu",
    "na",
    "nada",
    "nao",
    "não",
    "no",
    "nos",
    "o",
    "os",
    "ou",
    "para",
    "pra",
    "por",
    "posso",
    "pq",
    "qual",
    "quando",
    "que",
    "quero",
    "se",
    "sem",
    "ser",
    "seu",
    "sobre",
    "tao",
    "tem",
    "um",
    "uma",
    "usar",
    "vs",
  ].map(deaccent)
);

/**
 * Suffix rules applied until nothing matches, longest first. This is a
 * recall device, not linguistics: it only has to fold the forms the docs and
 * the questions actually use — `allocates` / `allocation` / `allocating` all
 * reaching `alloc` is the whole point — and it must be applied identically on
 * both sides, which is why index and query share this file.
 */
const SUFFIXES: [suffix: string, replacement: string][] = [
  ["ational", "ate"],
  ["ization", "ize"],
  ["isation", "ise"],
  ["ation", "ate"],
  ["ements", ""],
  ["ement", ""],
  ["ments", ""],
  ["ment", ""],
  ["ness", ""],
  ["ities", "ity"],
  ["ity", ""],
  ["ings", ""],
  ["ing", ""],
  ["edly", ""],
  ["ies", "y"],
  ["ed", ""],
  ["es", ""],
  ["ly", ""],
  ["able", ""],
  ["ible", ""],
  ["ates", "ate"],
  ["ate", ""],
  ["ers", ""],
  ["er", ""],
  ["ors", ""],
  ["or", ""],
  ["al", ""],
  ["at", ""],
  ["s", ""],
  ["e", ""],
];

const MIN_STEM_LENGTH = 3;

/**
 * Lowercases and removes diacritics, and nothing else.
 *
 * Every token on both sides of the index passes through this. A reader writes
 * "rápida", "código" and "geração"; the documentation is in English and the
 * index holds no accented character at all, so an accented token could only
 * ever match another accented token — which is to say, nothing. Stripping the
 * accent is what makes the literal half of a Portuguese question count for
 * anything before the synonym table gets involved.
 */
export function deaccent(word: string): string {
  return word
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

/**
 * Strips accents and the gender/number ending Portuguese puts on almost every
 * word. "rápida", "rapido" and "rapidas" are the same word to a reader asking
 * a question, and a concept that only matches one of them silently fails to
 * fire — which is how "pq a jit é rapida?" retrieved nothing about speed.
 */
export function fold(word: string): string {
  const bare = deaccent(word);

  const singular = bare.length > 4 && bare.endsWith("s") ? bare.slice(0, -1) : bare;
  // the final vowel carries the agreement, never the meaning
  return singular.length > 4 && /[aoe]$/.test(singular) ? singular.slice(0, -1) : singular;
}

/** Folds a word to the stem both sides of the index agree on. */
export function stem(word: string): string {
  let current = word;

  for (let pass = 0; pass < 3; pass++) {
    if (current.length <= MIN_STEM_LENGTH) return current;

    const rule = SUFFIXES.find(([suffix, replacement]) => {
      if (!current.endsWith(suffix)) return false;
      // "class" is not a plural, and a stem must stay a recognizable word
      if (suffix === "s" && (current.endsWith("ss") || current.endsWith("us"))) return false;
      return current.length - suffix.length + replacement.length >= MIN_STEM_LENGTH;
    });

    if (!rule) return current;
    current = current.slice(0, -rule[0].length) + rule[1];
  }

  return current;
}

/** Splits camelCase / PascalCase into its words, keeping runs of capitals. */
function splitCamelCase(word: string): string[] {
  return word
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .split(" ")
    .filter(Boolean);
}

/**
 * Produces the token stream for a piece of text. Compound identifiers emit
 * both the whole form and its parts, which is what lets a question written in
 * prose reach a section written in code.
 */
export function tokenize(text: string): string[] {
  const tokens: string[] = [];

  // Three forms are emitted. The exact word is rare and carries the precision —
  // only the migration page says "validator" — while the stem is common and
  // carries the recall. The Portuguese fold is what lets "rapida" and "rapido"
  // reach the same posting, which neither of the other two does. BM25's idf
  // already weighs them apart, so nothing has to choose between them.
  const push = (raw: string) => {
    const word = deaccent(raw);
    if (word.length <= 1 || STOPWORDS.has(word)) return;

    for (const form of new Set([word, stem(word), fold(word)])) {
      if (form.length > 1) tokens.push(form);
    }
  };

  for (const raw of text.split(/[^\p{L}\p{N}._-]+/u)) {
    if (!raw) continue;

    // a dotted path is a term of its own, and so is every segment
    const segments = raw.split(/[._-]+/).filter(Boolean);
    if (segments.length > 1) push(segments.join("").toLowerCase());

    for (const segment of segments) {
      const words = splitCamelCase(segment);
      if (words.length > 1) push(segment.toLowerCase());
      for (const word of words) push(word.toLowerCase());
    }
  }

  return tokens;
}

/** A query term and how much it is allowed to move the ranking. */
export interface QueryTerm {
  term: string;
  weight: number;
}

/**
 * One reader-written word and every form by which it can be present in the
 * corpus. This deliberately preserves the literal word: retrieval may use a
 * synonym to find a useful page, while the coverage gate still needs to know
 * whether an unsupported subject such as `postgres` was introduced.
 */
export interface QueryConcept {
  literal: string;
  variants: string[];
}

export function queryConcepts(query: string): QueryConcept[] {
  const concepts: QueryConcept[] = [];
  const seen = new Set<string>();

  for (const raw of query.split(/[^\p{L}\p{N}._-]+/u)) {
    if (!raw) continue;

    for (const segment of raw.split(/[._-]+/).filter(Boolean)) {
      const literal = deaccent(segment);
      const direct = tokenize(segment);
      if (direct.length === 0 || seen.has(literal)) continue;
      seen.add(literal);

      const expanded = tokenizeQuery(segment)
        .filter((term) => term.weight < 1)
        .map((term) => term.term);

      concepts.push({ literal, variants: [...new Set([...direct, ...expanded])] });
    }
  }

  return concepts;
}

/**
 * An expansion rescues a question that shares no word with the docs, so it has
 * to count — but it is a guess about intent, and a rare literal term like
 * "zod" says more than three common guesses. Weighting them below the words
 * the reader actually typed is what keeps "how fast is it compared to zod"
 * from becoming a search for every "Performance" heading on the site.
 */
const SYNONYM_WEIGHT = 0.25;

/**
 * The first expansion in a list is the one that captures the intent; the rest
 * widen the net. That ordering only matters when the expansions *are* the
 * query — a question written entirely in Portuguese shares no word with the
 * English docs, so every literal term scores zero and the ranking is decided
 * by these alone.
 */
const PRIMARY_SYNONYM_WEIGHT = 0.55;

/**
 * Query-side terms: the literal ones at full weight, plus the vocabulary the
 * docs actually use for the same idea at a reduced one. Expansions are
 * appended, never substituted.
 */
export function tokenizeQuery(query: string): QueryTerm[] {
  const tokens = tokenize(query);
  const terms: QueryTerm[] = tokens.map((term) => ({ term, weight: 1 }));

  for (const token of tokens) {
    const synonyms = EXPANSIONS.get(token) ?? EXPANSIONS.get(fold(token));
    if (!synonyms) continue;
    for (const [index, synonym] of synonyms.entries()) {
      terms.push({ term: synonym, weight: index === 0 ? PRIMARY_SYNONYM_WEIGHT : SYNONYM_WEIGHT });
    }
  }

  return terms;
}

/**
 * The table is written in plain words; the index holds words and stems, so an
 * expansion is registered under both and yields both.
 */
const EXPANSIONS = new Map<string, string[]>();

for (const [accented, synonyms] of Object.entries(SYNONYMS)) {
  const word = deaccent(accented);
  const values = synonyms.flatMap((synonym) => {
    const stemmed = stem(synonym);
    return stemmed === synonym ? [synonym] : [synonym, stemmed];
  });

  // folded too, so "rapida" reaches the entry written as "rapido"
  for (const key of new Set([word, stem(word), fold(word)])) {
    const existing = EXPANSIONS.get(key);
    if (existing) existing.push(...values);
    else EXPANSIONS.set(key, [...values]);
  }
}
