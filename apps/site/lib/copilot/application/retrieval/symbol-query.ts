/**
 * Turning what a reader typed into something the symbol index can look up.
 *
 * Everything below is one API:
 *
 *   JIT.string().uuid()      jit.string.uuid       .uuid()
 *   JIT.validate.safeParse   validate.safeParse    safeParse
 *
 * and a reader will type all six. §28 makes exact symbol lookup the first
 * thing that runs on every query, which only pays off if the normalization is
 * generous enough to catch the forms people actually write — an exact matcher
 * that only accepts one spelling is a matcher that almost never fires.
 *
 * It stays in `lib/` rather than in the compiler because the *query* is
 * normalized at runtime and the *index* is built from the same rules. Two
 * implementations would drift, and the symptom would be an exact match that
 * silently stops firing.
 */

import { stem } from "./tokenizer";

/** The candidate forms a query fragment could be naming, most specific first. */
export interface SymbolQuery {
  /** `jit.string.uuid` — a full path, when the reader wrote one. */
  path?: string;
  /** `uuid` — a bare name, for the index to resolve across kinds. */
  name?: string;
}

/**
 * Strips call syntax, generics and the leading `JIT`.
 *
 * `JIT.object({ id: JIT.string() })` normalizes to `jit.object`: the arguments
 * are their own expressions and the outer path stops at the first call whose
 * result is not immediately dotted into.
 */
export function normalizeSymbolInput(input: string): string {
  return input
    .trim()
    .replace(/<[^<>]*>/g, "")
    .replace(/\([^()]*\)/g, "")
    .replace(/[()]/g, "")
    .replace(/^\.+|\.+$/g, "")
    .replace(/\.{2,}/g, ".");
}

/**
 * Every symbol path a query fragment might be naming.
 *
 * Ordered most specific first, so a caller can take the first hit and stop:
 * `JIT.string().uuid()` should resolve to `jit.string.uuid` and never to the
 * bare `uuid`, which is valid on nothing else but might be one day.
 */
export function symbolCandidates(input: string): SymbolQuery[] {
  const normalized = normalizeSymbolInput(input);
  if (!normalized) return [];

  const segments = normalized.split(".").filter(Boolean);
  if (segments.length === 0) return [];

  const withoutRoot = segments[0].toLowerCase() === "jit" ? segments.slice(1) : segments;
  if (withoutRoot.length === 0) return [];

  const candidates: SymbolQuery[] = [];

  // the full path, as written
  if (withoutRoot.length > 1) candidates.push({ path: `jit.${withoutRoot.join(".")}` });

  // `JIT.string().min().uuid()` — the reader named a chain, and the last step
  // is what the question is about
  if (withoutRoot.length > 2) candidates.push({ path: `jit.${withoutRoot[0]}.${withoutRoot[withoutRoot.length - 1]}` });

  candidates.push({ path: `jit.${withoutRoot[0]}` });
  candidates.push({ name: withoutRoot[withoutRoot.length - 1] });

  return candidates;
}

/**
 * Fragments of a free-text question that look like they name an API.
 *
 * Split by confidence, because the two levels deserve different treatment and
 * conflating them was costing real answers in both directions.
 *
 * `stated` is a claim: a dotted path rooted at `JIT`, a name written with call
 * or member syntax, or a camelCase identifier. None of those are things a
 * reader writes by accident, so a hit is as good as the reader having named
 * the page.
 *
 * `implied` is a bare lowercase word that happens to be an API name. "como
 * validar um uuid?" means `JIT.string().uuid()` and must resolve — leaving
 * these out entirely meant exact lookup never fired on the questions readers
 * actually ask, since almost nobody types `JIT.string().uuid()` when they want
 * to know how to validate a UUID. But "how do I clone an object?" is not a
 * question about `JIT.object`, so these enter as a weaker signal and let the
 * other retrievers outvote them.
 */
export interface SymbolMentions {
  stated: string[];
  implied: string[];
}

/**
 * Words that are API names and ordinary nouns at the same time.
 *
 * Not an arbitrary list: it is exactly the schema factories named after the
 * type they build. Those are the words a question uses to describe its
 * subject — "how do I clone an object", "compare two dates" — rather than to
 * name an API, and they are the only overlap of that kind in the surface.
 * `mask`, `uuid`, `ndjson` and `cqrs` are never ordinary nouns in a question
 * about this library.
 */
const AMBIENT_NOUNS = new Set([
  "object",
  "string",
  "number",
  "boolean",
  "array",
  "date",
  "function",
  "record",
  "map",
  "set",
  "tuple",
  "union",
  "literal",
  "any",
  "unknown",
  "null",
  "int",
  "enum",
]);

export function extractSymbolMentions(question: string): SymbolMentions {
  const stated = new Set<string>();

  for (const match of question.matchAll(/\b(?:JIT|jit)((?:\.[A-Za-z_$][\w$]*(?:\([^)]*\))?)+)/g)) {
    stated.add(`jit${match[1]}`);
  }

  // `.safeParse(` / `.uuid()` — member or call syntax states the intent
  for (const match of question.matchAll(/(?:^|[\s(`'"])\.([A-Za-z_$][\w$]*)\s*\(?/g)) stated.add(match[1]);

  // a camelCase identifier is an API name in any language
  for (const match of question.matchAll(/\b([a-z][a-z0-9]*[A-Z][\w$]*)\b/g)) stated.add(match[1]);

  const implied = new Set<string>();
  for (const match of question.matchAll(/\b([A-Za-z][A-Za-z0-9_$]{2,})\b/g)) {
    // Case-folded: "what is a DTO in jit?" names `JIT.dto`, and requiring a
    // lowercase first letter meant the one spelling readers actually use for
    // an acronym API was the one spelling that never resolved.
    const word = match[1].toLowerCase();
    if (stated.has(word) || AMBIENT_NOUNS.has(word)) continue;

    implied.add(word);
    // "equality" and "equal" are one token to the index, so they should be one
    // name to the lookup. The stem is the form both sides already agree on.
    const stemmed = stem(word);
    if (stemmed !== word && stemmed.length > 2) implied.add(stemmed);
  }

  return { stated: [...stated], implied: [...implied] };
}
