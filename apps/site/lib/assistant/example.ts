import { scriptBlocks } from "./audit";

/**
 * Whether the code the ghost wrote actually runs.
 *
 * Every other check in the audit reads the answer. This one executes it. The
 * distinction matters because the failures readers reported last were all
 * name-clean: every identifier existed, every namespace was real, and the
 * example still did nothing useful — it declared a schema and stopped, or it
 * called a compiled function with data it never defined, or it looped until it
 * ran out of tokens. None of that is visible to a regular expression, and all
 * of it is obvious the moment the block is run.
 *
 * The rule this encodes is the one the documentation already follows: an
 * example is a schema, an operation compiled from it, and data to run it
 * against. Anything less is a fragment, and a fragment presented as an answer
 * is what "exemplos fracos" means.
 */

/** How long a single example may run before it is treated as a loop. */
export const EXAMPLE_TIMEOUT_MS = 1_500;

export type ExampleFailure =
  /** Used a value it never declared, so it cannot run as written. */
  | { kind: "undeclared"; name: string }
  /** Threw while running. */
  | { kind: "threw"; error: string }
  /** Never finished. */
  | { kind: "timeout" }
  /** Did not parse. */
  | { kind: "syntax"; error: string }
  /** Ran, but demonstrates nothing: it declares and never calls. */
  | { kind: "inert" };

/**
 * Fenced blocks that are teaching jit. A shell command or a JSON payload is
 * not an example of the library, and a block that never mentions it is not the
 * library's to be wrong about.
 */
export function exampleBlocks(answer: string): string[] {
  return scriptBlocks(answer).filter((code) => /\bJIT\./.test(code));
}

/**
 * The single block worth judging: the longest one that uses the library.
 *
 * An answer often shows a one-line fragment to make a point and then the real
 * thing. Running every block would report the fragment as broken, which is
 * both true and useless — the fragment was never the answer.
 */
export function mainExample(answer: string): string | null {
  let best: string | null = null;

  for (const code of exampleBlocks(answer)) {
    if (!best || code.length > best.length) best = code;
  }

  return best;
}

/**
 * Swaps the answer's example for one that is known to work, and says so.
 *
 * The last resort after the model has failed to write a working example twice.
 * Everything else in the answer survived the audit and is worth keeping; only
 * the block is replaced, and the reader is told where the replacement came
 * from — a silent substitution would be the ghost taking credit for the
 * documentation's work.
 */
export function replaceMainExample(answer: string, code: string, note: string): string {
  const target = mainExample(answer);
  if (!target) return `${answer}\n\n\`\`\`ts\n${code}\n\`\`\`\n\n${note}`;

  const replaced = answer.replace(target, `${code}\n`);
  // the note belongs under the block it is about
  const closing = replaced.indexOf("```", replaced.indexOf(code) + code.length);

  if (closing === -1) return `${replaced}\n\n${note}`;

  const cut = closing + 3;
  return `${replaced.slice(0, cut)}\n\n${note}${replaced.slice(cut)}`;
}

/**
 * The block as executable source. Imports go because the library is passed in
 * as a binding, and `export` goes because there is no module around it.
 */
export function prepareSource(code: string): string {
  return code
    .replace(/^\s*import[^\n]*$/gm, "")
    .replace(/^\s*export\s*\{[^}]*\};?\s*$/gm, "")
    .replace(/\bexport\s+(?=(?:const|let|var|function|class|type|interface|default)\b)/g, "");
}

/** Names the block binds itself, which are the only ones it may call. */
export function declaredNames(code: string): string[] {
  const names = new Set<string>();

  for (const match of code.matchAll(/\b(?:const|let|var|function|class)\s+([A-Za-z_$][\w$]*)/g)) {
    if (match[1]) names.add(match[1]);
  }
  // `const { a, b } = ...` binds through a pattern rather than a name
  for (const match of code.matchAll(/\b(?:const|let|var)\s*[{[]([^}\]]+)[}\]]/g)) {
    for (const part of (match[1] ?? "").split(",")) {
      const name = part
        .split(":")
        .pop()
        ?.trim()
        .replace(/^\.\.\./, "");
      if (name && /^[A-Za-z_$][\w$]*$/.test(name)) names.add(name);
    }
  }

  return [...names];
}

/**
 * Whether the example shows the library doing something, rather than only
 * describing a shape.
 *
 * A schema on its own compiles nothing and proves nothing: the reader still
 * cannot see what they get back, and the answer to "show me how to use it" was
 * a type declaration. So the bar is one call to something the block itself
 * declared — the compiled function being used, which is the whole point of the
 * library.
 */
export function demonstratesUsage(code: string): boolean {
  const declared = new Set(declaredNames(code));
  if (declared.size === 0) return false;

  for (const match of code.matchAll(/\b([A-Za-z_$][\w$]*)\s*\(/g)) {
    const name = match[1];
    if (!name || !declared.has(name)) continue;
    // the declaration itself is not a use of it
    if (new RegExp(`\\b(?:function|class)\\s+${name}\\s*\\(`).test(code)) continue;

    return true;
  }

  return false;
}

/**
 * Platform globals that read as schema names in an example.
 *
 * `JIT.array(Event)` in a browser resolves `Event` to the DOM constructor and
 * fails deep inside the compiler with something that looks like a real API
 * mistake. Shadowing them turns that back into what it is: a name the example
 * never declared.
 */
export const SHADOWED_GLOBALS = [
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

/** A binding that fails the way an undeclared name should. */
export function undeclaredStub(name: string): unknown {
  const raise = () => {
    throw new ReferenceError(`${name} is not defined`);
  };

  return new Proxy(function stub() {} as object, { get: raise, apply: raise, construct: raise });
}

/**
 * A block that says it throws is working when it does. The docs demonstrate
 * check ordering with a parse that fails on purpose, and the ghost copies that
 * shape correctly.
 */
const DEMONSTRATES_A_THROW = /\/\/[^\n]*\b(throws?|lan[çc]a|rejects?|erro|error)\b/i;

/** Engines disagree on the wording; both mean the same thing. */
const NOT_DEFINED = /^(?:(\w+) is not defined|Can't find variable: (\w+))/;

export function classifyThrow(error: unknown): ExampleFailure {
  if (error instanceof ReferenceError) {
    const name = NOT_DEFINED.exec(error.message);
    if (name) return { kind: "undeclared", name: name[1] ?? name[2] ?? "a value" };
  }

  if (error instanceof SyntaxError) return { kind: "syntax", error: error.message };

  return { kind: "threw", error: error instanceof Error ? `${error.name}: ${error.message}` : String(error) };
}

/** Whether a thrown error is the example demonstrating its own failure case. */
export function isIntentionalThrow(error: unknown, code: string): boolean {
  if (!DEMONSTRATES_A_THROW.test(code)) return false;
  return error instanceof Error && /validation/i.test(error.name);
}

/**
 * What to tell the reader, and what to tell the model. One sentence, naming
 * the thing that is wrong rather than the category it belongs to.
 */
export function describeFailure(failure: ExampleFailure): string {
  if (failure.kind === "undeclared") {
    return `it uses \`${failure.name}\` without declaring it, so it cannot be run as written. Declare the value the example needs, including the sample data.`;
  }
  if (failure.kind === "timeout") {
    return "it never finishes, so it loops. Write an example that runs once and stops.";
  }
  if (failure.kind === "syntax") {
    return `it is not valid TypeScript: ${failure.error}`;
  }
  if (failure.kind === "inert") {
    return "it declares a schema and never calls anything, so it shows the reader nothing running. Compile an operation from the schema and call it with a value.";
  }

  return `running it fails with ${failure.error}`;
}
