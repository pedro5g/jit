import type { KnowledgeId, RouteId, SymbolId } from "../value-objects/ids";

/**
 * Where a name lives in the library's three-level surface.
 *
 * `namespace` — `JIT.validate`, an object you reach through, never callable.
 * `factory`   — `JIT.string`, callable, and the start of a chain.
 * `function`  — `JIT.validate.safeParse`, callable, reached through a namespace.
 * `method`    — `.uuid()`, valid on some schema kinds and not on others.
 * `operator`  — a query/CQRS chain step: `.where()`, `.aggregate()`.
 * `type`      — `Typeof`, real but invisible to reflection.
 */
export type SymbolKind = "namespace" | "factory" | "function" | "method" | "operator" | "type";

/**
 * One public API name.
 *
 * This is the engine's answer to "does that exist?", and it is the reason the
 * audit can be strict. Every symbol here was reflected off the runtime or read
 * out of the type declarations — nothing on this list was written by hand, so
 * nothing on it can drift away from the library.
 *
 * `validOn` is the part reflection cannot supply. Every builder shares one
 * prototype, so `JIT.number().email` is a function at runtime and a type error
 * in an editor; only the conditional type in `core/builder/types.ts` knows
 * which kinds actually accept a method. Reflecting it would tell the model
 * that `.email()` is fine on a number, which is precisely the confident wrong
 * answer this whole system exists to prevent.
 */
export interface ApiSymbol {
  id: SymbolId;
  /** The last segment — `uuid` in `jit.string.uuid`. */
  name: string;
  /** The full dotted path as a reader writes it: `JIT.string().uuid()`. */
  path: string;

  kind: SymbolKind;
  parent?: SymbolId;

  /** Written forms, when the declaration gave one. Overloads list separately. */
  signatures: string[];

  /**
   * Schema kinds this method is allowed on: `["string"]`, `["number", "int"]`.
   * Empty for anything that is not a chain method.
   */
  validOn: string[];

  /**
   * Whether a chain method constrains a value or operates on the schema.
   *
   * `.min(3)` is a check; `.parse()`, `.optional()` and `.pipe()` are not. The
   * library draws the line itself — a check is declared in
   * `StringCheckMethods` and its siblings, everything else comes from
   * `BuilderCore` — and the extractor carries it here rather than letting each
   * consumer invent a list. Structured generation (§43) needs exactly this
   * distinction: the menu a model picks a validator from must not offer it
   * `.safeParse`.
   *
   * Absent for anything that is not a method.
   */
  role?: "check" | "operation";

  /** One line, from the API reference table. Empty when undocumented. */
  purpose: string;

  /** Where the name is documented. Absent means the docs never mention it. */
  routeId?: RouteId;

  /**
   * How much evidence stands behind `routeId`, graded rather than assumed.
   *
   * The association is inferred, and the strength of the inference varies
   * enormously. A reference-index row is an author stating which page owns a
   * name. A heading naming the symbol is nearly as strong. A declaration line
   * — `` - `uuid(version?)` `` in a list — is strong. A passing mention inside
   * an example on an unrelated page is barely evidence at all, and that is
   * where the wrong answers come from: `JIT.clone` was documented at
   * `reference/functions/canonical` because that page mentions it and sorts
   * earlier in the alphabet.
   *
   * Carried rather than thresholded, because the right response differs by
   * caller. Retrieval should use a weak association — a related page beats no
   * page. Automatic navigation should eventually not, because sending a reader
   * to a page that merely mentions the thing they asked about is worse than
   * offering no link. That gate is not built yet; this is the signal it will
   * read.
   */
  routeConfidence?: "declared" | "heading" | "declaration" | "mention";

  /** Entries that document or demonstrate this symbol, best first. */
  examples: KnowledgeId[];
}
