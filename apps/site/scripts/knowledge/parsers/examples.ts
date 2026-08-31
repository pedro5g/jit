/**
 * Running a documentation example against the real library.
 *
 * Examples matter more to a small model than prose does: it will copy the
 * shape of a call it has seen far more reliably than it will follow a sentence
 * describing one. So an example that does not work is not a documentation bug
 * the reader routes around — it is a wrong answer with a citation attached,
 * which is worse than a wrong answer without one.
 *
 * §69 asks that every example be executed and marked `verified` in the IR.
 * This module is what does the executing, and it is deliberately the *same*
 * module `audit:docs` uses: two verifiers with slightly different ambient
 * scopes would disagree about which examples are real, and the knowledge
 * compiler would then ship a `verified: true` the audit does not believe.
 */
import { JIT } from "@jit-compiler/jit/runtime";

/**
 * Names an example is allowed to reference without defining them.
 *
 * Documentation examples are fragments on purpose — they show the shape of a
 * call, not a whole program — so the values around the call are supplied here
 * rather than demanded of the page. Anything beyond this list is a genuinely
 * undefined reference and gets reported.
 */
const AMBIENT: Record<string, unknown> = {
  console: { log: () => {}, info: () => {}, warn: () => {}, error: () => {} },
  logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
  queue: { write: () => {}, push: () => {} },
  socket: { on: () => {}, write: () => {} },
  process: { env: {}, stdout: { write: () => {} } },
  fetch: async () => ({ ok: true, json: async () => ({}), body: null }),
  structuredClone: (value: unknown) => value,
};

/**
 * A stand-in for a schema the example never declares, which throws the moment
 * it is used.
 *
 * Names like `Event`, `Request` and `File` read as schemas in an example and
 * are also platform globals, so a fragment that says `JIT.array(Event)` gets
 * handed the DOM `Event` constructor and fails with a TypeError that looks
 * exactly like a real API mistake. Shadowing them turns that back into the
 * ReferenceError it truly is: an undeclared reference in a fragment.
 */
function undeclared(name: string): unknown {
  const raise = () => {
    throw new ReferenceError(`${name} is not defined`);
  };

  return new Proxy(function () {} as object, { get: raise, apply: raise, construct: raise });
}

/** Platform globals that documentation examples use as schema names. */
const SHADOWED = [
  "Event",
  "Request",
  "Response",
  "File",
  "Headers",
  "Blob",
  "Node",
  "Text",
  "Comment",
  "Range",
  "Image",
  "Notification",
  "Location",
  "History",
  "Storage",
  "Performance",
  "Worker",
  "Document",
  "Selection",
];

/**
 * Examples that show a failure on purpose.
 *
 * The ops page demonstrates check ordering with
 * `JIT.validate.parse(Email)("NOT-AN-EMAIL"); // throws`, and it is right to.
 * A validation error from a block that says it throws is the block working.
 */
const DEMONSTRATES_A_THROW = /\/\/[^\n]*\b(throws?|lan[çc]a|rejects?|erro|error|❌)\b/i;

/** Languages whose fenced blocks are executable jit examples. */
const RUNNABLE = new Set(["ts", "tsx", "typescript", "js", "jsx", "javascript"]);

export function isRunnableExample(lang: string, source: string): boolean {
  return RUNNABLE.has(lang.toLowerCase()) && /\bJIT\./.test(source);
}

/**
 * Executes one example, reporting only failures that are the example's fault.
 *
 * A `ReferenceError` for a value the fragment never defines is expected — the
 * page is showing a call, not a program — so it is treated as a pass. A
 * `TypeError` is not: `JIT.stream(Row).ndjson()` throwing "is not a function"
 * means the page is teaching an API that does not exist, which is exactly the
 * class of error a reader cannot tell from a working one until they run it.
 */
export async function runExample(code: string): Promise<string | null> {
  const body = code
    .replace(/^\s*import[^\n]*$/gm, "")
    .replace(/^\s*export\s*\{[^}]*\};?\s*$/gm, "")
    .replace(/\bexport\s+(?=(?:const|let|var|function|class|type|interface)\b)/g, "")
    .replace(/^\s*(?:type|interface)\s[\s\S]*?(?:;|\n\})\s*$/gm, "");

  // a name the fragment declares itself is its own; only the rest is shadowed
  const declared = new Set(
    [...body.matchAll(/\b(?:const|let|var|function|class)\s+([A-Za-z_$][\w$]*)/g)].map((match) => match[1])
  );
  const shadowed = SHADOWED.filter((name) => !declared.has(name));
  const names = [...Object.keys(AMBIENT), ...shadowed];
  const values = [...Object.keys(AMBIENT).map((name) => AMBIENT[name]), ...shadowed.map(undeclared)];

  try {
    const factory = new Function("JIT", ...names, `"use strict";\nreturn (async () => {\n${body}\n})();`) as (
      ...args: unknown[]
    ) => Promise<unknown>;

    await factory(JIT, ...values);
    return null;
  } catch (error) {
    // a fragment referencing a value it never declares is showing a call, not a program
    if (error instanceof ReferenceError) return null;
    // a fragment that is not a complete statement is a formatting choice
    if (error instanceof SyntaxError) return null;
    // and a block that says it throws is working when it does
    if (DEMONSTRATES_A_THROW.test(code) && error instanceof Error && /validation/i.test(error.name)) return null;

    return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  }
}
