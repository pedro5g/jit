/**
 * The questions the ghost is held to, and what a right answer looks like for
 * each one.
 *
 * The older golden set asked only whether an acceptable page reached the
 * model's context. That bar is too low to catch the failure readers actually
 * hit: the changelog ranks first for almost every conceptual question, because
 * it is written in exactly their vocabulary and its sections are short enough
 * for BM25's length normalization to favour them. An answer built on release
 * notes is where "jit --version" and ".run()" come from.
 *
 * So each entry carries three judgements rather than one:
 *   `best`      — a page that must rank first; this is the answer.
 *   `ok`        — pages that legitimately cover the same ground; context is enough.
 *   `forbidden` — pages that must not reach the top three, because reading them
 *                 as the answer produces a confidently wrong one.
 *
 * `concepts` pins what the graph must recognise, since a question that resolves
 * to no concept gets no ground truth, no identity anchor and no expansion — the
 * silent failure behind most invented answers.
 */
export interface GoldQuestion {
  question: string;
  /** Ranked first. Empty when several pages are equally right. */
  best?: string[];
  /** Acceptable within the retrieved window. */
  ok?: string[];
  /** Must not reach the top three. */
  forbidden?: string[];
  /** Concept ids the graph must match directly (weight 1). */
  concepts?: string[];
  /** Marks a question the reader asks in Portuguese. */
  lang?: "pt" | "en";
}

/** Pages whose subject is history, not behaviour. */
export const HISTORICAL = ["/docs/whats-new", "/docs/guides/migrating-to-2"];

export const GOLD: GoldQuestion[] = [
  // ---------------------------------------------------------------- purpose
  // The reason the library exists. None of these had an answer in the docs or
  // a node in the graph, and all three retrieved unrelated reference pages.
  {
    question: "por que a jit existe?",
    lang: "pt",
    best: ["/docs/concepts/why-jit"],
    ok: ["/docs", "/docs/concepts/compilation-model"],
    forbidden: HISTORICAL,
    concepts: ["purpose", "self"],
  },
  {
    question: "qual problema a jit resolve?",
    lang: "pt",
    best: ["/docs/concepts/why-jit"],
    ok: ["/docs", "/docs/concepts/compilation-model"],
    forbidden: HISTORICAL,
    concepts: ["purpose", "self"],
  },
  {
    question: "what problem does jit solve?",
    best: ["/docs/concepts/why-jit"],
    ok: ["/docs", "/docs/concepts/compilation-model"],
    forbidden: HISTORICAL,
    concepts: ["purpose", "self"],
  },
  {
    question: "why should I use jit instead of writing the checks by hand?",
    ok: ["/docs/concepts/why-jit", "/docs", "/docs/reference/library-comparison"],
    forbidden: HISTORICAL,
    concepts: ["purpose"],
  },
  {
    question: "o que é a jit?",
    lang: "pt",
    ok: ["/docs", "/docs/concepts/why-jit", "/docs/concepts/compilation-model"],
    forbidden: HISTORICAL,
    concepts: ["self"],
  },

  // ------------------------------------------------------------ performance
  // The question from the bug report. The changelog answered it before.
  {
    question: "pq a jit é tão rapida ?",
    lang: "pt",
    best: ["/docs/concepts/compilation-model"],
    ok: ["/docs/reference/benchmarks", "/docs/concepts/why-jit", "/docs"],
    forbidden: HISTORICAL,
    concepts: ["performance", "self"],
  },
  {
    question: "pq jit é tão rápido?",
    lang: "pt",
    best: ["/docs/concepts/compilation-model"],
    ok: ["/docs/reference/benchmarks", "/docs/concepts/why-jit", "/docs"],
    forbidden: HISTORICAL,
    concepts: ["performance", "self"],
  },
  {
    question: "why is the generated code so fast?",
    best: ["/docs/concepts/compilation-model", "/docs/concepts/why-jit"],
    ok: ["/docs/reference/benchmarks", "/docs"],
    forbidden: HISTORICAL,
    concepts: ["performance", "compilation"],
  },
  {
    question: "how fast is it compared to zod",
    ok: ["/docs/reference/library-comparison", "/docs/reference/benchmarks"],
    concepts: ["comparison"],
  },
  {
    question: "a jit aloca memória a cada validação?",
    lang: "pt",
    ok: ["/docs/runtime/validation", "/docs/reference/functions/validation", "/docs/reference/benchmarks"],
    concepts: ["memory", "validation"],
  },

  // ------------------------------------------------------------- compilation
  {
    question: "como a jit compila o schema?",
    lang: "pt",
    best: ["/docs/concepts/compilation-model"],
    ok: ["/docs", "/docs/concepts/why-jit"],
    forbidden: HISTORICAL,
    concepts: ["compilation"],
  },
  {
    question: "what is the difference between runtime JIT and AOT?",
    ok: [
      "/docs/concepts/compilation-model",
      "/docs/guides/choosing-an-execution-mode",
      "/docs/concepts/why-jit",
      "/docs",
    ],
    // "runtime" and "aot" are the concepts the words carry; `compilation`
    // arrives through their edges, which is the graph working as intended.
    concepts: ["aot"],
  },
  {
    question: "does it work under a strict CSP in the browser?",
    best: ["/docs/guides/browser-and-edge"],
    concepts: ["bundle"],
  },

  // -------------------------------------------------------------- validation
  {
    question: "como valido um objeto?",
    lang: "pt",
    ok: ["/docs/runtime/validation", "/docs/reference/functions/validation", "/docs/quick-start"],
    forbidden: HISTORICAL,
    concepts: ["validation"],
  },
  {
    question: "como valido sem alocar nada?",
    lang: "pt",
    ok: ["/docs/runtime/validation", "/docs/reference/functions/validation"],
    concepts: ["validation"],
  },
  {
    question: "how does safeParse work?",
    ok: ["/docs/runtime/validation", "/docs/reference/functions/validation"],
    forbidden: HISTORICAL,
    concepts: ["validation"],
  },
  {
    question: "qual a diferença entre is, parse e safeParse?",
    lang: "pt",
    ok: ["/docs/runtime/validation", "/docs/reference/functions/validation"],
    forbidden: HISTORICAL,
    concepts: ["validation"],
  },
  {
    question: "How do I declare a schema and validate a value?",
    ok: ["/docs/runtime/validation", "/docs/quick-start", "/docs/reference/functions/validation"],
    concepts: ["schema", "validation"],
  },
  {
    question: "como leio os erros de validação?",
    lang: "pt",
    ok: ["/docs/reference/functions/validation", "/docs/runtime/validation"],
    concepts: ["errors", "validation"],
  },

  // ------------------------------------------------------------------- APIs
  { question: "deep clone an object fast", best: ["/docs/reference/functions/clone"], concepts: ["compare"] },
  {
    question: "immutable update without proxy",
    ok: ["/docs/reference/functions/update", "/docs/runtime/reactive-updates"],
    concepts: ["update"],
  },
  {
    question: "mask PII before logging",
    ok: ["/docs/reference/functions/mask", "/docs/guides/boundary-recipes"],
    concepts: ["security"],
  },
  {
    question: "como mascarar PII?",
    lang: "pt",
    ok: ["/docs/reference/functions/mask", "/docs/guides/boundary-recipes"],
    concepts: ["security"],
  },
  {
    question: "openapi document from a schema",
    best: ["/docs/reference/functions/json-schema"],
    concepts: ["jsonschema"],
  },
  { question: "stream ndjson while it downloads", best: ["/docs/reference/functions/stream"], concepts: ["lazy"] },
  {
    question: "binary wire format version",
    ok: ["/docs/reference/functions/codec", "/docs/runtime/serialization"],
    concepts: ["codec"],
  },
  {
    question: "consulta com filtro sobre uma lista grande",
    lang: "pt",
    ok: ["/docs/runtime/queries", "/docs/runtime/binary-rowsets", "/docs/guides/choosing-an-execution-mode"],
    concepts: ["query"],
  },
  {
    question: "what is a DTO here",
    ok: ["/docs/reference/functions/dto", "/docs/runtime/dtos", "/docs/guides/boundary-recipes"],
    concepts: ["boundary"],
  },
  { question: "mcp server tools", best: ["/docs/guides/mcp-server"], concepts: ["mcp"] },
  {
    question: "self referencing recursive schema",
    ok: ["/docs/reference/functions/composition", "/docs/reference/operators/schemas-and-wrappers"],
    concepts: ["composition"],
  },
  {
    question: "como faço uma união discriminada?",
    lang: "pt",
    ok: ["/docs/reference/functions/composition", "/docs/reference/operators/schemas-and-wrappers"],
    concepts: ["composition"],
  },

  // --------------------------------------------------------------- AOT / CLI
  {
    question: "generate code ahead of time with the CLI",
    ok: [
      "/docs/aot/cli-and-config",
      "/docs/aot/generation-and-tree-shaking",
      "/docs/aot/artifact-cli",
      "/docs/quick-start",
    ],
    concepts: ["aot"],
  },
  {
    question: "what is AOT generation?",
    ok: ["/docs/aot/generation-and-tree-shaking", "/docs/concepts/compilation-model", "/docs/reference/functions"],
    concepts: ["aot"],
  },
  { question: "how do I install jit", best: ["/docs/quick-start"], concepts: ["install"] },
  { question: "como instalo a jit?", lang: "pt", best: ["/docs/quick-start"], concepts: ["install"] },

  // --------------------------------------------------------- the app itself
  {
    question: "o que é o workspace?",
    lang: "pt",
    ok: ["/docs/aot/artifact-cli", "/docs/guides/executable-examples", "/workspace"],
    concepts: ["workspace"],
  },
  {
    question: "posso rodar o código de exemplo no site?",
    lang: "pt",
    ok: ["/docs/guides/executable-examples", "/docs/aot/artifact-cli", "/workspace"],
    concepts: ["workspace"],
  },

  // -------------------------------------------------------------- migration
  // The one class of question where the historical pages ARE the answer.
  { question: "what changed in 2.0", best: HISTORICAL, concepts: ["migration"] },
  {
    question: "JIT.validator was removed, what do I use now?",
    best: ["/docs/guides/migrating-to-2"],
    concepts: ["migration"],
  },
  {
    question: "quero migrar do 1.x para o 2.0",
    lang: "pt",
    best: ["/docs/guides/migrating-to-2"],
    concepts: ["migration"],
  },
];
