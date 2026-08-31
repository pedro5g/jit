/**
 * Which APIs a passage is about.
 *
 * This is the edge that makes the whole engine work: it is what turns "the
 * reader typed `safeParse`" into "these four passages document it", with no
 * ranking involved at all. §3.3 — a question a lookup can answer must never
 * reach the model as a search problem.
 *
 * The linking is deliberately conservative. A passage that merely *mentions*
 * `JIT.object` while explaining something else should not become a top hit for
 * "how do I build an object schema", so a mention only counts when the text
 * calls the API or names it in a heading. The cost of a missed link is one
 * ranking that falls back to BM25; the cost of a spurious one is a wrong page
 * cited with maximum confidence.
 */
import type { ApiSymbol } from "../../../lib/copilot/core/entities/api-symbol";
import { type SymbolId, symbolId } from "../../../lib/copilot/core/value-objects/ids";
import { scanJitExpressions } from "../../../lib/copilot/core/value-objects/jit-expression";

/** A symbol a passage names, and how strongly it says so. */
export interface SymbolLink {
  id: SymbolId;
  /** 3 when a heading names it, 2 when a line declares it, 1 for a mention. */
  weight: number;
}

export interface SymbolIndexInput {
  symbols: readonly ApiSymbol[];
  /** Chain methods per schema kind, for resolving a bare `.uuid()`. */
  chain: Record<string, string[]>;
}

/**
 * Resolves the names in a passage to symbol ids.
 *
 * The resolver is built once and reused across every section, because the two
 * maps it needs — every id, and every method name to the kinds it is valid on
 * — cost more to build than the entire linking pass.
 */
export function createSymbolLinker({ symbols, chain }: SymbolIndexInput) {
  const known = new Set<string>(symbols.map((symbol) => symbol.id));

  /** Method name -> the schema kinds it is valid on. */
  const kindsForMethod = new Map<string, string[]>();
  for (const [kind, methods] of Object.entries(chain)) {
    if (kind === "default") continue;
    for (const method of methods) {
      const kinds = kindsForMethod.get(method) ?? [];
      kinds.push(kind);
      kindsForMethod.set(method, kinds);
    }
  }

  /**
   * A path fragment is only a symbol if the index says so.
   *
   * Headings are split on non-identifier characters, so this is handed things
   * like `50k` and `2` from "Validating 50k rows". `symbolId` refuses those —
   * correctly, they are not symbol paths — so the refusal is caught here
   * rather than allowed to abort a build over a number in a heading.
   */
  const idFor = (path: string): SymbolId | null => {
    if (!/^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*$/.test(path)) return null;

    const id = symbolId(path);
    return known.has(id) ? id : null;
  };

  /**
   * Names a passage demonstrates, with the ones it is *about* first.
   *
   * The weight is the whole point, and dropping it was a real bug: without it
   * a symbol's `routeId` and `examples` were assigned by whichever file the
   * walk reached first, so `JIT.clone` came out documented at
   * `reference/functions/canonical` — the page before `clone` alphabetically
   * that happens to mention it — with the migration guide as its top example.
   *
   * A heading is the strongest statement a page makes about its subject, so a
   * symbol named there outranks one merely called in an example.
   */
  return function link(text: string, heading: string): SymbolLink[] {
    const found = new Map<SymbolId, number>();
    const note = (id: SymbolId, weight: number) => found.set(id, Math.max(found.get(id) ?? 0, weight));

    for (const [source, weight] of [
      [heading, 3],
      [text, 1],
    ] as const) {
      for (const expression of scanJitExpressions(source)) {
        const root = idFor(`jit.${expression.root}`);
        if (!root) continue;

        note(root, weight);

        if (expression.member) {
          const member = idFor(`jit.${expression.root}.${expression.member}`);
          if (member) note(member, weight);
        }

        // `JIT.string().min(3)` — the chain belongs to the factory it started
        // from, which is the one case where the kind is known for certain.
        for (const call of expression.calls) {
          const scoped = idFor(`jit.${expression.root}.${call}`);
          if (scoped) note(scoped, weight);
        }
      }
    }

    /**
     * Lines that *declare* a method rather than use one.
     *
     * The reference pages define chain methods as list items and table rows:
     *
     *   - `uuid(version?)` and permissive UUID-like `guid()`;
     *
     * which is a completely different claim from the same name appearing
     * inside an example on another page. Without this distinction `.uuid()`
     * was documented at `reference/functions/composition` — a page that calls
     * it twice inside code samples about branding — because that page sorts
     * before `reference/operators/strings`, which is where it is actually
     * defined. Ranking by evidence only helps when the evidence is graded.
     */
    for (const match of text.matchAll(/^[ \t]*(?:[-*+]|\|)?[ \t]*`\.?([A-Za-z_$][\w$]*)\s*\(/gm)) {
      const word = match[1];
      const kinds = kindsForMethod.get(word);

      if (kinds) {
        for (const kind of kinds) {
          const id = idFor(`jit.${kind}.${word}`);
          if (id) note(id, 2);
        }
      }

      const top = idFor(`jit.${word}`);
      if (top) note(top, 2);
    }

    // A heading like "uuid" or "safeParse" names an API without writing
    // `JIT.` at all, and the reference pages are full of them. Only headings,
    // and only when the name is unambiguous: a bare `.min()` in prose belongs
    // to four kinds and linking it to all of them is noise.
    for (const word of heading.split(/[^A-Za-z0-9_$]+/).filter(Boolean)) {
      const kinds = kindsForMethod.get(word);
      if (kinds?.length === 1) {
        const id = idFor(`jit.${kinds[0]}.${word}`);
        if (id) note(id, 3);
      }

      const top = idFor(`jit.${word}`);
      if (top) note(top, 3);
    }

    return [...found.entries()]
      .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
      .map(([id, weight]) => ({ id, weight }));
  };
}

/**
 * Names in a passage that the library does not have.
 *
 * The migration guide quotes them on purpose — its job is showing
 * `JIT.validator` next to what replaced it — and once a section is chunked,
 * the "// 1.x" comment that framed the block may not travel with the code. A
 * model reading the fragment sees a removed name presented as ordinary code
 * and writes it back out, so the entry is marked and the prompt says what it
 * is.
 */
export function quotesRemovedApis(text: string, symbols: readonly ApiSymbol[]): boolean {
  const roots = new Set(symbols.filter((symbol) => !symbol.parent).map((symbol) => symbol.name));

  for (const expression of scanJitExpressions(text)) {
    if (!roots.has(expression.root)) return true;
  }

  return false;
}
