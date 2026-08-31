/**
 * The public surface, stated to the model.
 *
 * This replaces the hand-written "what jit is, always true" block, or at least
 * the half of it that was a list of names. That block said things like "every
 * capability is reached through exactly one namespace: JIT.validate.*,
 * JIT.compare.*, JIT.security.*" — true, useful, and a sentence somebody had
 * to remember to edit when a namespace was added. §111 in one line: it comes
 * from the real source now.
 *
 * What it is *for* matters more than what it contains. A small model given a
 * page about masking will write `JIT.security.redact` if `redact` sounds
 * right, because nothing in front of it says otherwise. The list is not
 * reference material for the model to reason from — it is the boundary of what
 * it is allowed to say, and it is the single cheapest defence against an
 * invented name reaching a reader.
 */
import type { ApiSymbol } from "../../core/entities/api-symbol";
import type { SymbolRepository } from "../../core/repositories";

/**
 * Every top-level name, with a namespace's members spelled out.
 *
 * A namespace spends its line on its members rather than on prose.
 * `JIT.validate` is never written by anyone; `JIT.validate.is` is, and listing
 * the purpose text instead left the model to guess the method — which is
 * exactly how `JIT.compare.deepEqual` got written.
 */
export function surfaceListing(symbols: SymbolRepository): string {
  const namespaces: string[] = [];
  const plain: string[] = [];
  const types: string[] = [];

  for (const symbol of symbols.all()) {
    if (symbol.parent) continue;

    if (symbol.kind === "type") {
      types.push(symbol.name);
      continue;
    }

    const members = symbols
      .related(symbol.id)
      .filter((child) => child.parent === symbol.id && (child.kind === "function" || child.kind === "namespace"))
      .map((child) => child.name);

    if (members.length > 0) namespaces.push(`JIT.${symbol.name}.{ ${members.sort().join(", ")} }`);
    else plain.push(symbol.name);
  }

  /**
   * Namespaces are spelled out; everything else is a comma-separated list.
   *
   * The purpose text used to sit on every line, and it took the block from
   * 330 tokens to a thousand — a fifth of the prompt spent restating what the
   * retrieved documentation says better. What the list is for is the
   * *boundary*, not the explanation: the model needs to know `redact` is not a
   * member of `JIT.security`, and a name in a comma-separated list says that
   * exactly as well as a name on its own line.
   */
  const lines = [...namespaces.sort()];
  if (plain.length > 0) lines.push(`Also, callable directly: ${plain.sort().join(", ")}`);
  if (types.length > 0) lines.push(`Type-only exports: ${types.sort().join(", ")}`);

  return lines.join("\n");
}

/**
 * What the reader's own question named, in detail.
 *
 * Short and specific, which is what a small model uses best: the signature it
 * should write, and — the part reflection cannot supply — the schema kinds a
 * chain method is actually allowed on. `.email()` is a function at runtime on
 * every builder and a type error on all but one, so without `validOn` the
 * model has no way to know that `JIT.number().email()` is wrong.
 */
export function symbolFacts(symbols: readonly ApiSymbol[], repository: SymbolRepository): string {
  if (symbols.length === 0) return "";

  const lines = symbols.slice(0, 6).map((symbol) => {
    const parts = [symbol.path];

    if (symbol.signatures.length > 0) parts.push(`  signature: ${symbol.signatures[0]}`);
    if (symbol.purpose) parts.push(`  purpose: ${symbol.purpose}`);
    if (symbol.validOn.length > 0) parts.push(`  valid on: ${symbol.validOn.join(", ")}`);

    if (symbol.kind === "namespace") {
      const members = repository
        .related(symbol.id)
        .filter((child) => child.parent === symbol.id)
        .map((child) => child.name);

      if (members.length > 0) parts.push(`  members: ${members.join(", ")}`);
    }

    return parts.join("\n");
  });

  return lines.join("\n");
}
