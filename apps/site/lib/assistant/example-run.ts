import {
  classifyThrow,
  declaredNames,
  type ExampleFailure,
  isIntentionalThrow,
  prepareSource,
  SHADOWED_GLOBALS,
  undeclaredStub,
} from "./example";

/**
 * Executing one example, in whichever place is doing the executing.
 *
 * The browser runs this inside a disposable worker so a loop can be killed by
 * terminating the thread; the test suite runs it directly against the real
 * package. Both go through this function, so what the reader is protected from
 * is exactly what the suite proves.
 */

export interface EvaluateOptions {
  /** The library, passed as a binding rather than imported by the example. */
  jit: unknown;
  /**
   * TypeScript to JavaScript. An example is written in TypeScript and a type
   * annotation is not something `new Function` will accept, so this is not
   * optional in practice — but a caller that already holds JavaScript can pass
   * the identity function.
   */
  transpile: (source: string) => string;
}

/** Values an example may use without declaring them. Deliberately almost none. */
function ambient(): Record<string, unknown> {
  const noop = () => {};
  return { console: { log: noop, info: noop, warn: noop, error: noop, debug: noop, table: noop } };
}

export async function evaluateExample(code: string, options: EvaluateOptions): Promise<ExampleFailure | null> {
  const source = prepareSource(code);

  let body: string;
  try {
    body = options.transpile(source);
  } catch (error) {
    return { kind: "syntax", error: error instanceof Error ? error.message : String(error) };
  }

  // a name the example declares is its own; only the rest is shadowed
  const declared = new Set(declaredNames(source));
  const shadowed = SHADOWED_GLOBALS.filter((name) => !declared.has(name));
  const supplied = ambient();
  const names = [...Object.keys(supplied), ...shadowed];
  const values = [...Object.keys(supplied).map((name) => supplied[name]), ...shadowed.map(undeclaredStub)];

  try {
    const factory = new Function("JIT", ...names, `"use strict";\nreturn (async () => {\n${body}\n})();`) as (
      ...args: unknown[]
    ) => Promise<unknown>;

    await factory(options.jit, ...values);
    return null;
  } catch (error) {
    if (isIntentionalThrow(error, code)) return null;
    return classifyThrow(error);
  }
}
