import type { KnowledgeGraphRepository, KnowledgeRepository } from "../core/repositories";
import type { RouteId } from "../core/value-objects/ids";
import type { EvalCase } from "./types";

interface ExplanationDefinition {
  question: string;
  locale: EvalCase["locale"];
  route: RouteId;
  anchor?: string;
}

const WHY = "route.docs.concepts.why-jit" as RouteId;
const COMPILATION = "route.docs.concepts.compilation-model" as RouteId;
const VALIDATION = "route.docs.reference.functions.validation" as RouteId;
const EQUAL = "route.docs.reference.functions.equal" as RouteId;
const CLONE = "route.docs.reference.functions.clone" as RouteId;
const QUERY = "route.docs.reference.functions.query" as RouteId;
const EXECUTION = "route.docs.guides.choosing-an-execution-mode" as RouteId;

/** Conceptual prompts; expectations point at sources, never preferred chunks or answer strings. */
const DEFINITIONS: ExplanationDefinition[] = [
  { question: "por que a JIT é tão rápida?", locale: "pt-BR", route: WHY, anchor: "why-the-generated-code-is-fast" },
  { question: "why is jit fast?", locale: "en", route: WHY, anchor: "why-the-generated-code-is-fast" },
  { question: "como a JIT funciona?", locale: "pt-BR", route: COMPILATION },
  { question: "how does jit work?", locale: "en", route: COMPILATION },
  { question: "o que significa compiled data engine?", locale: "pt-BR", route: WHY },
  { question: "what does compiled data engine mean?", locale: "en", route: WHY },
  { question: "por que compilar schemas?", locale: "pt-BR", route: WHY, anchor: "the-same-work-paid-on-every-call" },
  { question: "why compile schemas?", locale: "en", route: WHY, anchor: "the-same-work-paid-on-every-call" },
  { question: "qual a diferença entre runtime e AOT?", locale: "pt-BR", route: WHY, anchor: "why-two-execution-modes" },
  {
    question: "what is the difference between runtime and AOT?",
    locale: "en",
    route: WHY,
    anchor: "why-two-execution-modes",
  },
  {
    question: "como o código gerado fica mais rápido?",
    locale: "pt-BR",
    route: COMPILATION,
    anchor: "why-the-generated-path-is-fast",
  },
  {
    question: "how does generated code become faster?",
    locale: "en",
    route: COMPILATION,
    anchor: "why-the-generated-path-is-fast",
  },
  { question: "como a validation funciona?", locale: "pt-BR", route: VALIDATION },
  { question: "how does validation work?", locale: "en", route: VALIDATION },
  { question: "como equality funciona?", locale: "pt-BR", route: EQUAL },
  { question: "how does equality work?", locale: "en", route: EQUAL },
  { question: "como clone funciona?", locale: "pt-BR", route: CLONE },
  { question: "how does clone work?", locale: "en", route: CLONE },
  { question: "como queries funcionam?", locale: "pt-BR", route: QUERY },
  { question: "how do queries work?", locale: "en", route: QUERY },
  {
    question: "por que evitar interpretar o schema toda vez?",
    locale: "pt-BR",
    route: WHY,
    anchor: "the-same-work-paid-on-every-call",
  },
  {
    question: "why avoid interpreting the schema every time?",
    locale: "en",
    route: WHY,
    anchor: "the-same-work-paid-on-every-call",
  },
  { question: "o que sai do compilador da JIT?", locale: "pt-BR", route: COMPILATION },
  { question: "what comes out of the jit compiler?", locale: "en", route: COMPILATION },
  { question: "como runtime JIT é armazenado em cache?", locale: "pt-BR", route: COMPILATION, anchor: "runtime-jit" },
  { question: "how is runtime JIT cached?", locale: "en", route: COMPILATION, anchor: "runtime-jit" },
  {
    question: "por que AOT não precisa do engine no bundle?",
    locale: "pt-BR",
    route: COMPILATION,
    anchor: "build-time-aot",
  },
  {
    question: "why does AOT not need the engine in the bundle?",
    locale: "en",
    route: COMPILATION,
    anchor: "build-time-aot",
  },
  {
    question: "quando a JIT não é a escolha certa?",
    locale: "pt-BR",
    route: WHY,
    anchor: "when-jit-is-not-the-right-tool",
  },
  { question: "when is jit not the right choice?", locale: "en", route: WHY, anchor: "when-jit-is-not-the-right-tool" },
  { question: "como o parser da JIT evita overhead?", locale: "pt-BR", route: COMPILATION },
  { question: "how does the jit parser avoid overhead?", locale: "en", route: COMPILATION },
  { question: "o que acontece desde o schema até uma operação compilada?", locale: "pt-BR", route: COMPILATION },
  { question: "what happens from a schema to a compiled operation?", locale: "en", route: COMPILATION },
  { question: "por que runtime e AOT produzem o mesmo comportamento?", locale: "pt-BR", route: EXECUTION },
  { question: "why can runtime and AOT produce the same behavior?", locale: "en", route: EXECUTION },
  {
    question: "como operações diferentes usam o mesmo schema?",
    locale: "pt-BR",
    route: WHY,
    anchor: "one-shape-a-dozen-jobs",
  },
  {
    question: "how do different operations use the same schema?",
    locale: "en",
    route: WHY,
    anchor: "one-shape-a-dozen-jobs",
  },
  {
    question: "como a JIT reduz alocações no hot path?",
    locale: "pt-BR",
    route: WHY,
    anchor: "why-the-generated-code-is-fast",
  },
  {
    question: "how does jit reduce hot-path allocations?",
    locale: "en",
    route: WHY,
    anchor: "why-the-generated-code-is-fast",
  },
];

export function explanationCases(): EvalCase[] {
  return DEFINITIONS.map((definition) => ({
    question: definition.question,
    category: "concept",
    locale: definition.locale,
    expected: {
      routes: [definition.route],
      best: definition.route,
      ...(definition.anchor ? { anchor: definition.anchor } : {}),
    },
  }));
}

/** Resolves expected facets from the compiled source metadata used by the run. */
export function resolveExplanationFacets(
  cases: readonly EvalCase[],
  knowledge: KnowledgeRepository,
  graph?: KnowledgeGraphRepository
): EvalCase[] {
  return cases.map((testCase) => {
    const route = testCase.expected.routes?.[0] ?? testCase.expected.best;
    if (!route) return testCase;

    const entries = knowledge
      .all()
      .filter(
        (entry) =>
          entry.routeId === route && (testCase.expected.anchor ? entry.anchor === testCase.expected.anchor : true)
      );
    const related = graph
      ? entries.flatMap((entry) =>
          graph
            .neighbours(entry.id)
            .filter((edge) => edge.kind === "reference" || edge.kind === "parent" || edge.kind === "child")
            .flatMap((edge) => knowledge.findById(edge.to) ?? [])
        )
      : [];
    const facets = [
      ...new Set(
        [...entries, ...related].flatMap((entry) =>
          entry.facets
            .filter((facet) => facet.source === "heading" || facet.source === "concept")
            .map((facet) => facet.id)
        )
      ),
    ].slice(0, 10);
    return { ...testCase, expected: { ...testCase.expected, facets } };
  });
}
