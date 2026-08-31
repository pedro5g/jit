/**
 * Eval cases generated from the symbol index.
 *
 * §70 asks for 200 cases. Writing 200 by hand produces a set that is stale the
 * first time a page is renamed and that nobody dares to regenerate, so most of
 * ours are derived instead: for every documented public member, the question
 * "what does JIT.x do?" has exactly one correct answer, and both the symbol
 * and the route come from the same artifacts retrieval is being tested
 * against.
 *
 * That gives roughly 150 cases that cannot go stale and that grow with the
 * library. The hand-written half in `cases.ts` covers what cannot be derived:
 * the conceptual questions, the Portuguese phrasings, the ambiguity, and the
 * traps.
 *
 * A derived case is a weaker test than a hand-written one — it uses the API's
 * own name, so it is the easy case. That is deliberate. A retriever that
 * cannot find `JIT.mask` when asked about `JIT.mask` has a defect no amount of
 * conceptual tuning will hide, and §106 sets exact-symbol accuracy at 100%
 * precisely because this is the floor.
 */
import type { ApiSymbol } from "../core/entities/api-symbol";
import type { RouteId, SymbolId } from "../core/value-objects/ids";
import type { EvalCase } from "./types";

/** Phrasings a reader actually uses for "explain this API to me". */
const TEMPLATES: { render: (path: string) => string; locale: "en" | "pt-BR" }[] = [
  { render: (path) => `what does ${path} do?`, locale: "en" },
  { render: (path) => `how do I use ${path}?`, locale: "en" },
  { render: (path) => `o que faz ${path}?`, locale: "pt-BR" },
  { render: (path) => `como uso ${path}?`, locale: "pt-BR" },
];

export function derivedCases(symbols: readonly ApiSymbol[]): EvalCase[] {
  const cases: EvalCase[] = [];

  // Top-level members only. A method case would need the schema kind in the
  // question to be answerable, and `.min()` genuinely has four right answers.
  const documented = symbols.filter(
    (symbol) => !symbol.parent && symbol.routeId && symbol.kind !== "type" && symbol.examples.length > 0
  );

  for (const [index, symbol] of documented.entries()) {
    // Rotated rather than crossed: four phrasings times 74 members is 296
    // near-identical cases that take four times as long to run and measure the
    // same thing. One phrasing each, spread across all four.
    const template = TEMPLATES[index % TEMPLATES.length];

    cases.push({
      question: template.render(symbol.path),
      category: "api-lookup",
      locale: template.locale,
      expected: {
        symbols: [symbol.id as SymbolId],
        routes: [symbol.routeId as RouteId],
        best: symbol.routeId as RouteId,
      },
    });
  }

  return cases;
}

/**
 * Cases that must resolve a symbol without naming a route.
 *
 * A namespace member is written `JIT.validate.safeParse` and documented on the
 * page of its namespace, so the route expectation would be the same for all of
 * them and would test nothing. What is worth testing is that the three-level
 * path resolves at all — that was the level the old assistant could not see,
 * and the level `JIT.compare.deepEqual` was invented at.
 */
export function derivedSymbolCases(symbols: readonly ApiSymbol[]): EvalCase[] {
  return symbols
    .filter((symbol) => symbol.kind === "function" && symbol.parent)
    .map((symbol, index) => ({
      question: index % 2 === 0 ? `${symbol.path}` : `what is ${symbol.path}?`,
      category: "api-lookup" as const,
      locale: "en" as const,
      expected: { symbols: [symbol.id as SymbolId] },
    }));
}
