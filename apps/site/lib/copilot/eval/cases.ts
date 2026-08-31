/**
 * The cases that cannot be derived.
 *
 * Everything here is a question whose right answer is a judgement: what "why
 * is jit fast" should return, what a Portuguese reader means by "como valido
 * um uuid", which page must never win. The derived half of the set covers the
 * easy direction — the API's own name — and this half covers the way readers
 * actually ask.
 *
 * Ported from the ghost's older gold set, which named URLs. Route ids survive
 * a rename; URLs did not, so half of that set was silently measuring the
 * routing rather than the retrieval.
 */
import type { RouteId, SymbolId } from "../core/value-objects/ids";
import type { EvalCase } from "./types";

const route = (id: string) => id as RouteId;
const symbol = (id: string) => id as SymbolId;

/**
 * Pages whose subject is history, not behaviour.
 *
 * They are written in exactly the vocabulary of every conceptual question and
 * their sections are short, which every length-normalized ranking rewards. Any
 * conceptual case that does not forbid them is a case that will pass while the
 * ghost answers out of release notes.
 */
const HISTORY = [route("route.docs.whats-new"), route("route.docs.guides.migrating-to-2")];

export const HAND_WRITTEN_CASES: EvalCase[] = [
  // ------------------------------------------------------------- purpose
  {
    question: "por que a jit existe?",
    category: "concept",
    locale: "pt-BR",
    expected: { routes: [route("route.docs.concepts.why-jit"), route("route.docs")] },
    forbidden: HISTORY,
  },
  {
    question: "qual problema a jit resolve?",
    category: "concept",
    locale: "pt-BR",
    expected: { routes: [route("route.docs.concepts.why-jit"), route("route.docs")] },
    forbidden: HISTORY,
  },
  {
    question: "what problem does jit solve?",
    category: "concept",
    locale: "en",
    expected: { routes: [route("route.docs.concepts.why-jit"), route("route.docs")] },
    forbidden: HISTORY,
  },
  {
    question: "why is jit fast?",
    category: "concept",
    locale: "en",
    expected: { routes: [route("route.docs.concepts.compilation-model"), route("route.docs.concepts.why-jit")] },
    forbidden: HISTORY,
    note: "The single question the old ranking got most wrong: the changelog says 'Faster compilation' and won.",
  },
  {
    question: "pq a jit é tão rápida?",
    category: "concept",
    locale: "pt-BR",
    expected: { routes: [route("route.docs.concepts.compilation-model"), route("route.docs.concepts.why-jit")] },
    forbidden: HISTORY,
  },
  {
    question: "how does jit compile schemas?",
    category: "concept",
    locale: "en",
    expected: {
      routes: [route("route.docs.concepts.compilation-model")],
      best: route("route.docs.concepts.compilation-model"),
    },
    forbidden: HISTORY,
  },
  {
    question: "como a jit compila os esquemas?",
    category: "concept",
    locale: "pt-BR",
    expected: { routes: [route("route.docs.concepts.compilation-model")] },
    forbidden: HISTORY,
  },

  // -------------------------------------------------------- installation
  {
    question: "como instalo a jit?",
    category: "navigation",
    locale: "pt-BR",
    expected: { routes: [route("route.docs.quick-start")], best: route("route.docs.quick-start") },
    forbidden: HISTORY,
  },
  {
    question: "how do I install jit?",
    category: "navigation",
    locale: "en",
    expected: { routes: [route("route.docs.quick-start")], best: route("route.docs.quick-start") },
    forbidden: HISTORY,
  },
  {
    question: "getting started",
    category: "navigation",
    locale: "en",
    expected: { routes: [route("route.docs.quick-start"), route("route.docs")] },
  },

  // ---------------------------------------------------------- validation
  {
    question: "como validar um uuid?",
    category: "simple-code",
    locale: "pt-BR",
    expected: {
      symbols: [symbol("symbol.jit.string.uuid")],
      routes: [route("route.docs.reference.operators.strings"), route("route.docs.runtime.validation")],
    },
    note: "§13: a Portuguese question must reach an English passage about UUID strings.",
  },
  {
    question: "how do I validate a uuid?",
    category: "simple-code",
    locale: "en",
    expected: {
      symbols: [symbol("symbol.jit.string.uuid")],
      routes: [route("route.docs.reference.operators.strings"), route("route.docs.runtime.validation")],
    },
  },
  {
    question: "qual a diferença entre parse e safeParse?",
    category: "api-lookup",
    locale: "pt-BR",
    expected: {
      symbols: [symbol("symbol.jit.validate.safeParse")],
      routes: [route("route.docs.reference.functions.validation"), route("route.docs.runtime.validation")],
    },
  },
  {
    question: "what is the difference between parse and safeParse?",
    category: "api-lookup",
    locale: "en",
    expected: {
      symbols: [symbol("symbol.jit.validate.safeParse")],
      routes: [route("route.docs.reference.functions.validation"), route("route.docs.runtime.validation")],
    },
  },
  {
    question: "como faço um type guard?",
    category: "simple-code",
    locale: "pt-BR",
    expected: { routes: [route("route.docs.reference.functions.validation"), route("route.docs.runtime.validation")] },
  },
  {
    question: "validar sem lançar exceção",
    category: "simple-code",
    locale: "pt-BR",
    expected: { routes: [route("route.docs.reference.functions.validation"), route("route.docs.runtime.validation")] },
    note: "No symbol expectation: 'validar' is not a name, so this is retrieval's job and not exact lookup's.",
  },

  // --------------------------------------------------------------- speed
  {
    question: "how fast is jit compared to zod?",
    category: "concept",
    locale: "en",
    expected: { routes: [route("route.docs.reference.library-comparison"), route("route.docs.reference.benchmarks")] },
    forbidden: HISTORY,
  },
  {
    question: "jit vs typia",
    category: "concept",
    locale: "en",
    expected: { routes: [route("route.docs.reference.library-comparison"), route("route.docs.reference.benchmarks")] },
  },

  // ----------------------------------------------------------------- aot
  {
    question: "how do I generate code ahead of time?",
    category: "concept",
    locale: "en",
    expected: { routes: [route("route.docs.aot.generation-and-tree-shaking"), route("route.docs.aot.cli-and-config")] },
    forbidden: HISTORY,
  },
  {
    question: "como gerar código antes da execução?",
    category: "concept",
    locale: "pt-BR",
    expected: { routes: [route("route.docs.aot.generation-and-tree-shaking"), route("route.docs.aot.cli-and-config")] },
    forbidden: HISTORY,
  },
  {
    question: "does jit work with a strict CSP?",
    category: "concept",
    locale: "en",
    expected: { routes: [route("route.docs.guides.browser-and-edge"), route("route.docs.aot.purity")] },
    note: "A CSP without unsafe-eval is the reason AOT exists; the answer is never the runtime page.",
  },
  {
    question: "posso usar no navegador?",
    category: "concept",
    locale: "pt-BR",
    expected: { routes: [route("route.docs.guides.browser-and-edge")] },
  },
  {
    question: "how do I reduce bundle size?",
    category: "concept",
    locale: "en",
    expected: { routes: [route("route.docs.aot.generation-and-tree-shaking")] },
  },

  // ------------------------------------------------------------ features
  {
    question: "how do I deep clone an object fast?",
    category: "simple-code",
    locale: "en",
    expected: {
      symbols: [symbol("symbol.jit.clone")],
      routes: [route("route.docs.reference.functions.clone")],
      best: route("route.docs.reference.functions.clone"),
    },
    forbidden: [route("route.docs.reference.operator-matrix")],
    note: "The operator matrix names clone in two words and used to outrank the page that explains it.",
  },
  {
    question: "como clonar um objeto?",
    category: "simple-code",
    locale: "pt-BR",
    expected: { routes: [route("route.docs.reference.functions.clone")] },
    note: "'clonar' is not a name either — the synonym table and the multilingual embedding are what carry this one.",
  },
  {
    question: "compare two objects for equality",
    category: "simple-code",
    locale: "en",
    expected: {
      routes: [route("route.docs.reference.functions.equal")],
      best: route("route.docs.reference.functions.equal"),
    },
  },
  {
    question: "how do I mask sensitive fields?",
    category: "simple-code",
    locale: "en",
    expected: { symbols: [symbol("symbol.jit.security.mask")], routes: [route("route.docs.reference.functions.mask")] },
  },
  {
    question: "como esconder dados sensíveis nos logs?",
    category: "simple-code",
    locale: "pt-BR",
    expected: { routes: [route("route.docs.reference.functions.mask")] },
  },
  {
    question: "how do I filter a large list?",
    category: "complex-code",
    locale: "en",
    expected: { routes: [route("route.docs.runtime.queries"), route("route.docs.reference.functions.query")] },
  },
  {
    question: "como filtrar uma lista grande?",
    category: "complex-code",
    locale: "pt-BR",
    expected: { routes: [route("route.docs.runtime.queries"), route("route.docs.reference.functions.query")] },
  },
  {
    question: "how do I serialize to json quickly?",
    category: "simple-code",
    locale: "en",
    expected: { routes: [route("route.docs.runtime.serialization"), route("route.docs.reference.functions.json")] },
  },
  {
    question: "streaming validation of a large ndjson file",
    category: "complex-code",
    locale: "en",
    expected: {
      routes: [route("route.docs.reference.functions.stream"), route("route.docs.reference.functions.ndjson")],
    },
  },
  {
    question: "how do I handle recursive schemas?",
    category: "complex-code",
    locale: "en",
    expected: {
      routes: [
        route("route.docs.concepts.schemas-and-types"),
        route("route.docs.reference.functions.schema-factories"),
      ],
    },
  },
  {
    question: "what is a DTO in jit?",
    category: "concept",
    locale: "en",
    expected: {
      symbols: [symbol("symbol.jit.dto")],
      routes: [route("route.docs.runtime.dtos"), route("route.docs.reference.functions.dto")],
    },
  },
  {
    question: "domain driven design with jit",
    category: "concept",
    locale: "en",
    expected: { routes: [route("route.docs.guides.domain-driven-design")] },
  },
  {
    question: "how do I apply an immutable update?",
    category: "simple-code",
    locale: "en",
    expected: {
      symbols: [symbol("symbol.jit.state.update")],
      routes: [route("route.docs.reference.functions.update"), route("route.docs.runtime.reactive-updates")],
    },
  },

  // ------------------------------------------------------------- history
  {
    question: "what changed in 2.0?",
    category: "navigation",
    locale: "en",
    expected: { routes: [route("route.docs.whats-new"), route("route.docs.guides.migrating-to-2")] },
    note: "The one shape of question where the history pages are the right answer.",
  },
  {
    question: "como migro da versão 1?",
    category: "navigation",
    locale: "pt-BR",
    expected: { routes: [route("route.docs.guides.migrating-to-2")], best: route("route.docs.guides.migrating-to-2") },
  },

  // ----------------------------------------------------------- ambiguous
  {
    question: "performance",
    category: "ambiguous",
    locale: "en",
    expected: { routes: [route("route.docs.reference.benchmarks"), route("route.docs.concepts.why-jit")] },
    note: "A dozen pages have a Performance heading. The breadcrumb is what tells them apart.",
  },
  {
    question: "how does it work?",
    category: "ambiguous",
    locale: "en",
    expected: { routes: [route("route.docs.concepts.compilation-model"), route("route.docs")] },
    forbidden: HISTORY,
  },

  // ------------------------------------------------------- page context
  {
    question: "how do I use this?",
    category: "follow-up",
    locale: "en",
    context: { routeId: route("route.docs.reference.functions.mask") },
    expected: {
      routes: [route("route.docs.reference.functions.mask")],
      best: route("route.docs.reference.functions.mask"),
    },
    note: "§34: with no subject of its own, the page the reader is on is the only signal there is.",
  },
  {
    question: "and for arrays?",
    category: "follow-up",
    locale: "en",
    context: { routeId: route("route.docs.reference.functions.clone") },
    expected: { routes: [route("route.docs.reference.functions.clone")] },
  },

  // ------------------------------------------------- hallucination traps
  {
    question: "how do I use JIT.compare.deepEqual?",
    category: "hallucination-trap",
    locale: "en",
    expected: {
      routes: [route("route.docs.reference.functions.equal")],
    },
    note: "JIT.compare is real; deepEqual is not. The near miss must resolve to compare.equal and never be echoed back.",
  },
  {
    question: "what does .notEmpty() do?",
    category: "hallucination-trap",
    locale: "en",
    expected: { routes: [route("route.docs.reference.operators.strings")] },
    note: "Not a real method. The strings page is where the real minimum-length check lives.",
  },
  {
    question: "how do I call JIT.validator on a schema?",
    category: "hallucination-trap",
    locale: "en",
    expected: {
      routes: [route("route.docs.reference.functions.validation"), route("route.docs.guides.migrating-to-2")],
    },
    note: "JIT.validator was removed in 2.0 — the migration guide is a legitimate answer to this one.",
  },

  // ---------------------------------------------------------- negatives
  {
    question: "how do I connect jit to postgres?",
    category: "negative",
    locale: "en",
    expected: {},
    expectsNoEvidence: true,
    note: "jit is not a database client. The honest answer is that there is no evidence for this.",
  },
  {
    question: "does jit support graphql subscriptions?",
    category: "negative",
    locale: "en",
    expected: {},
    expectsNoEvidence: true,
  },
  {
    question: "qual o preço da licença enterprise?",
    category: "negative",
    locale: "pt-BR",
    expected: {},
    expectsNoEvidence: true,
  },
];
