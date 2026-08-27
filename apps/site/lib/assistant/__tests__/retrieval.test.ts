import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { JIT } from "@jit-compiler/jit/runtime";
import { describe, expect, it } from "vitest";
import { DocsRetriever } from "../retrieval";
import { tokenize, tokenizeQuery } from "../tokenize";
import type { DocsIndex } from "../types";
import { conceptPages, conceptTerms, understand } from "../understanding";

const indexPath = resolve(import.meta.dirname, "../../../public/assistant/docs-index.json");
const index = JSON.parse(readFileSync(indexPath, "utf8")) as DocsIndex;
const retriever = new DocsRetriever(index);

/**
 * What retrieval owes an answer is that an acceptable page reaches the model's
 * context — not that it wins first place, since several pages legitimately
 * cover the same question from different angles. Each entry lists every page
 * that would be a good answer.
 */
const goldenQuestions: { question: string; pages: string[] }[] = [
  { question: "how do I install jit", pages: ["/docs/quick-start"] },
  { question: "what changed in 2.0", pages: ["/docs/whats-new", "/docs/guides/migrating-to-2"] },
  { question: "JIT.validator was removed, what do I use now?", pages: ["/docs/guides/migrating-to-2"] },
  {
    question: "como valido sem alocar nada?",
    pages: ["/docs/runtime/validation", "/docs/reference/functions/validation"],
  },
  {
    // Every AOT page answers this, including the quick start's own
    // "Go ahead-of-time" section and the artifact CLI guide.
    question: "generate code ahead of time with the CLI",
    pages: [
      "/docs/aot/cli-and-config",
      "/docs/aot/generation-and-tree-shaking",
      "/docs/aot/artifact-cli",
      "/docs/quick-start",
    ],
  },
  { question: "does it work under a strict CSP in the browser?", pages: ["/docs/guides/browser-and-edge"] },
  { question: "mask PII before logging", pages: ["/docs/reference/functions/mask", "/docs/guides/boundary-recipes"] },
  {
    question: "self referencing recursive schema",
    pages: ["/docs/whats-new", "/docs/reference/functions/composition"],
  },
  { question: "openapi document from a schema", pages: ["/docs/reference/functions/json-schema"] },
  {
    question: "how fast is it compared to zod",
    pages: ["/docs/reference/library-comparison", "/docs/reference/benchmarks"],
  },
  { question: "quero migrar do 1.x para o 2.0", pages: ["/docs/guides/migrating-to-2"] },
  {
    question: "consulta com filtro sobre uma lista grande",
    pages: ["/docs/runtime/queries", "/docs/runtime/binary-rowsets", "/docs/guides/choosing-an-execution-mode"],
  },
  { question: "deep clone an object fast", pages: ["/docs/reference/functions/clone"] },
  { question: "stream ndjson while it downloads", pages: ["/docs/reference/functions/ndjson"] },
  { question: "binary wire format version", pages: ["/docs/reference/functions/codec", "/docs/runtime/serialization"] },
  {
    question: "immutable update without proxy",
    pages: ["/docs/reference/functions/update", "/docs/runtime/reactive-updates"],
  },
  { question: "mcp server tools", pages: ["/docs/guides/mcp-server"] },
  { question: "what is a DTO here", pages: ["/docs/reference/functions/dto", "/docs/runtime/dtos"] },
  // Both asked by a reader and answered wrongly before the expansion weights
  // were split: a question written entirely in Portuguese is carried by its
  // expansions alone, so their order decides the ranking.
  {
    question: "pq jit é tão rápido?",
    pages: ["/docs/concepts/compilation-model", "/docs/whats-new", "/docs/reference/benchmarks"],
  },
  { question: "why is the generated code so fast?", pages: ["/docs/concepts/compilation-model", "/docs/whats-new"] },
  {
    question: "How do I declare a schema and validate a value?",
    pages: ["/docs/runtime/validation", "/docs/quick-start", "/docs/reference/functions/validation"],
  },
];

/**
 * The same path the assistant takes, in full.
 *
 * This used to pass only the concept terms, which quietly made the test a
 * different search from the real one: without `allowHistory` the migration
 * guide is ranked down even when the question is about a migration, and
 * without `conceptPages` the graph's opinion never reaches the score. A test
 * that measures a search the product does not run measures nothing.
 */
const search = (question: string, currentUrl?: string) => {
  const understanding = understand(question, { api: index.api, currentUrl: currentUrl ?? "", previous: null });

  return retriever.search(question, {
    limit: 6,
    conceptTerms: conceptTerms(understanding.concepts),
    allowHistory: understanding.wantsHistory,
    conceptPages: conceptPages(understanding.concepts),
    ...(currentUrl ? { currentUrl } : {}),
  });
};

const pagesFor = (question: string, limit: number) =>
  search(question)
    .slice(0, limit)
    .map((result) => result.section.url.split("#")[0]);

describe("tokenize", () => {
  it("emits the whole identifier and its parts for a dotted path", () => {
    expect(tokenize("JIT.validate.safeParse")).toEqual(
      expect.arrayContaining(["jitvalidatesafeparse", "jit", "validate", "safeparse", "safe", "parse"])
    );
  });

  it("splits camelCase without losing the original name", () => {
    const tokens = tokenize("stringifyChunks");

    expect(tokens).toContain("stringifychunks");
    expect(tokens).toContain("stringify");
    expect(tokens).toContain("chunks");
  });

  it("drops stopwords in both documentation languages", () => {
    expect(tokenize("how do I use this")).toEqual([]);
    expect(tokenize("como faço para usar isso")).toEqual([]);
  });

  it("expands a query into the vocabulary the docs use, below the literal terms", () => {
    const terms = tokenizeQuery("redact pii");
    const literal = terms.filter((term) => term.weight === 1).map((term) => term.term);
    const expanded = terms.filter((term) => term.weight < 1).map((term) => term.term);

    expect(literal).toEqual(["redact", "pii"]);
    expect(expanded).toContain("mask");
  });
});

describe("DocsRetriever", () => {
  it("indexes every section of the built documentation", () => {
    expect(index.documents.length).toBeGreaterThan(300);
    expect(retriever.hasVectors).toBe(false);
  });

  /**
   * The prompt carries this list so the model cannot invent a name, and the
   * site suite already pins the same file against `Object.keys(JIT)` — so a
   * new export reaches the ghost as soon as it reaches the docs.
   */
  it("ships the complete public API alongside the sections", () => {
    expect(index.api.map((member) => member.name).sort()).toEqual(Object.keys(JIT).sort());
    expect(index.api.every((member) => member.url.startsWith("/docs/"))).toBe(true);
  });

  /**
   * A doc that teaches an API the library does not have is worse than a
   * missing doc: it feeds the model a name it will confidently repeat. The
   * only pages allowed to mention a removed name are the ones whose subject
   * is the removal.
   */
  it("teaches no API outside the public surface, except where the subject is migration", () => {
    const known = new Set([...index.api.map((member) => member.name), "Typeof", "Strict"]);
    const migrationPages = ["/docs/guides/migrating-to-2", "/docs/whats-new"];

    const offenders = index.documents
      .filter((section) => !migrationPages.some((page) => section.url.startsWith(page)))
      .flatMap((section) =>
        [...section.text.matchAll(/\bJIT\.([A-Za-z_$][A-Za-z0-9_$]*)/g)]
          .map((match) => match[1])
          .filter((name) => !known.has(name))
          .map((name) => `${section.url}: JIT.${name}`)
      );

    expect(offenders).toEqual([]);
  });

  it("marks the sections that quote removed APIs", () => {
    const marked = index.documents.filter((section) => section.showsRemovedApis);

    expect(marked.length).toBeGreaterThan(0);
    expect(marked.every((section) => /migrating-to-2|whats-new/.test(section.url))).toBe(true);
  });

  it("returns nothing for a query made only of stopwords", () => {
    expect(retriever.search("how do I")).toEqual([]);
  });

  it.each(goldenQuestions)("puts an answer to $question in the model's context", ({ question, pages }) => {
    const retrieved = pagesFor(question, 6);

    expect(pages.some((page) => retrieved.includes(page))).toBe(true);
  });

  /**
   * Ranking quality as a whole, measured rather than asserted question by
   * question: a single doc edit may reorder one answer, but a real regression
   * in the tokenizer or the scoring moves the aggregate.
   */
  it("ranks an acceptable page first for most questions and top-three for nearly all", () => {
    const first = goldenQuestions.filter(({ question, pages }) => pages.includes(pagesFor(question, 1)[0]));
    const topThree = goldenQuestions.filter(({ question, pages }) =>
      pagesFor(question, 3).some((page) => pages.includes(page))
    );

    expect(first.length / goldenQuestions.length).toBeGreaterThanOrEqual(0.75);
    expect(topThree.length / goldenQuestions.length).toBeGreaterThanOrEqual(0.9);
  });

  it("puts an unambiguous question first, not merely in context", () => {
    const results = search("JIT.validator was removed, what do I use now?");

    expect(results[0].section.url.split("#")[0]).toBe("/docs/guides/migrating-to-2");
  });

  it("never returns more than two sections of the same page", () => {
    const results = search("query filter projection lazy iterator");
    const perPage = new Map<string, number>();

    for (const result of results) {
      const page = result.section.url.split("#")[0];
      perPage.set(page, (perPage.get(page) ?? 0) + 1);
    }

    expect([...perPage.values()].every((count) => count <= 2)).toBe(true);
  });

  it("lifts the page being read without discarding better answers", () => {
    const question = "how do I compile this ahead of time";
    const neutral = retriever.search(question, { limit: 10 });
    const runnerUp = neutral[2].section.url;

    const boosted = retriever.search(question, { limit: 10, currentUrl: runnerUp });
    const before = neutral.find((result) => result.section.url === runnerUp);
    const after = boosted.find((result) => result.section.url === runnerUp);

    expect(after?.score).toBeGreaterThan(before?.score ?? 0);
    // a boost, not a takeover: the best neutral answer is still retrieved
    expect(boosted.map((result) => result.section.url)).toContain(neutral[0].section.url);
  });

  it("scores a hybrid ranking when vectors are attached", () => {
    const dimensions = 4;
    const vectors = index.documents.map((_, position) => {
      const vector = new Float32Array(dimensions);
      vector[position % dimensions] = 1;
      return vector;
    });

    const hybrid = new DocsRetriever(index);
    hybrid.setVectors(vectors);
    expect(hybrid.hasVectors).toBe(true);

    const queryVector = new Float32Array(dimensions);
    queryVector[0] = 1;
    const results = hybrid.search("validation", { limit: 5, queryVector });

    expect(results.length).toBeGreaterThan(0);
    expect(results.every((result) => result.semantic >= 0)).toBe(true);
  });

  it("ignores a vector set that does not match the index", () => {
    const mismatched = new DocsRetriever(index);
    mismatched.setVectors([new Float32Array(4)]);

    expect(mismatched.hasVectors).toBe(false);
  });
});
