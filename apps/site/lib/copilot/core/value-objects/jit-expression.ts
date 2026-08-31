/**
 * Parsing `JIT.…` out of arbitrary text.
 *
 * Two callers need exactly this, and they are at opposite ends of the system:
 * the knowledge compiler, which links a documentation passage to the symbols
 * it demonstrates, and the audit, which checks the names in a generated answer
 * against the symbols that exist. Both have to agree on what counts as a call,
 * or the audit will reject an API the compiler indexed.
 *
 * A regex cannot do this. `JIT.string().min(3).email()` has to yield `string`
 * plus `min` and `email`, and the arguments in between have to be stepped over
 * rather than matched. Getting the chain right is what lets the audit judge
 * `.min()` against the methods a string actually has, instead of giving up on
 * everything past the first dot.
 */

/**
 * One parsed `JIT.…` expression from an answer: where it started and every
 * method called on it afterwards.
 */
export interface JitExpression {
  /** The top-level member, e.g. `validate` in `JIT.validate.safeParse(User)`. */
  root: string;
  /** The namespace member, when the expression reached through one. */
  member?: string;
  /** Methods called on the result, in order. */
  calls: string[];
  /** The literal text, for a readable finding. */
  text: string;
  /**
   * The root was written `jit.` rather than `JIT.`.
   *
   * Models write it both ways, and the lowercase form used to be invisible —
   * `await jit.generate({ inputSchema: ... })`, an API that does not exist in
   * any casing, passed every check because the scan was anchored to `JIT.`.
   * It is tracked rather than normalized because `jit.config.ts` is a real
   * filename, so a lowercase root needs a call before it can be judged.
   */
  lowercase: boolean;
}

const IDENTIFIER = /[A-Za-z_$][A-Za-z0-9_$]*/y;

/**
 * Reads an identifier at `index`, or returns null.
 */
function identifierAt(source: string, index: number): string | null {
  IDENTIFIER.lastIndex = index;
  return IDENTIFIER.exec(source)?.[0] ?? null;
}

/**
 * Skips a balanced `(...)` or `[...]` starting at `index`, returning the
 * position just past it — or `index` when there is nothing to skip.
 *
 * Arguments are skipped rather than parsed because a call's arguments are
 * their own expressions: `JIT.object({ id: JIT.string() })` contains a second
 * chain, and the outer walk must not confuse `string` for a method called on
 * `object`. The nested one is found by the scan's own next pass.
 */
function skipBalanced(source: string, index: number): number {
  const open = source[index];
  if (open !== "(" && open !== "[") return index;

  const close = open === "(" ? ")" : "]";
  let depth = 0;

  let previous = "";

  for (let i = index; i < source.length; i++) {
    const character = source[i];
    // a string literal can hold an unbalanced bracket, so it is stepped over
    if (character === '"' || character === "'" || character === "`") {
      const quote = character;
      i += 1;
      while (i < source.length && source[i] !== quote) i += source[i] === "\\" ? 2 : 1;
      previous = quote;
      continue;
    }

    // So can a regular expression, and jit examples are full of them —
    // `.regex(/[)]/)` closes the call three characters early otherwise, and
    // the rest of the chain is read as if it belonged to nothing. A slash
    // after an operator or an opening bracket starts a literal; after a value
    // it is division.
    if (character === "/" && (previous === "" || "([,=:!&|?{;+-*%".includes(previous))) {
      let inClass = false;
      i += 1;
      while (i < source.length) {
        const inner = source[i];
        if (inner === "\\") {
          i += 2;
          continue;
        }
        // a `/` inside `[...]` is a literal slash, not the end of the pattern
        if (inner === "/" && !inClass) break;
        if (inner === "[") inClass = true;
        else if (inner === "]") inClass = false;
        i += 1;
      }
      previous = "/";
      continue;
    }

    if (character.trim()) previous = character;

    if (character === open) depth += 1;
    else if (character === close) {
      depth -= 1;
      if (depth === 0) return i + 1;
    }
  }

  return source.length;
}

/**
 * Every `JIT.…` expression in a piece of text, with the chain that follows it.
 *
 * A regex cannot do this: `JIT.string().min(3).email()` has to yield `string`
 * plus `min` and `email`, and the arguments in between have to be stepped over
 * rather than matched. Getting the chain right is what lets the audit judge
 * `.min()` against the methods a string actually has, instead of giving up on
 * everything past the first dot — which is what it used to do.
 */
export function scanJitExpressions(text: string): JitExpression[] {
  const found: JitExpression[] = [];

  for (const match of text.matchAll(/(?<![A-Za-z0-9_$/@-])(JIT|jit)\./g)) {
    const start = match.index + match[0].length;
    const root = identifierAt(text, start);
    if (!root) continue;

    let cursor = start + root.length;
    const lowercase = match[1] === "jit";
    let member: string | undefined;

    // `JIT.validate.safeParse(...)` — the second segment belongs to the
    // namespace, not to the chain, and is checked against a different list.
    if (text[cursor] === "." && text[cursor + 1] !== ".") {
      const next = identifierAt(text, cursor + 1);
      if (next) {
        member = next;
        cursor += 1 + next.length;
      }
    }

    const calls: string[] = [];
    for (;;) {
      const afterArguments = skipBalanced(text, cursor);
      cursor = afterArguments;

      if (text[cursor] !== ".") break;
      const name = identifierAt(text, cursor + 1);
      if (!name) break;

      cursor += 1 + name.length;
      // a property read (`.plan`) is not a call and is not checked as one
      if (text[cursor] === "(") calls.push(name);
    }

    found.push({ root, ...(member ? { member } : {}), calls, lowercase, text: text.slice(match.index, cursor) });
  }

  return found;
}
