import { JIT } from "../../lab/generated/jit_compiler.js";
import { evaluateExample } from "../example-run";
import type { ExampleRequest, ExampleResponse } from "./example-protocol";

/**
 * Runs the ghost's examples away from the page.
 *
 * A worker rather than the main thread for one reason: an example that loops
 * cannot be interrupted from inside, and terminating a thread is the only way
 * to stop it. The reader's tab stays responsive while the ghost finds out that
 * what it wrote does not work.
 */

interface Transpiler {
  transpile: (source: string) => string;
  /** False once the real compiler failed to load and the fallback is in use. */
  exact: boolean;
}

/**
 * Type annotations are not something `new Function` accepts, so a source that
 * carries them has to be compiled before it can run — and the compiler is
 * three megabytes, which is not a thing to fetch for every answer.
 *
 * So the example is run as written first. If it parses, it was already
 * JavaScript and nothing needed stripping; the compiler is fetched only when
 * the source does not parse, which is the only case where an annotation could
 * be the reason. A failure that is not a syntax error never reaches this at
 * all, because the code ran and told us what was wrong with it.
 */
let loading: Promise<Transpiler> | null = null;

function loadTranspiler(): Promise<Transpiler> {
  loading ??= import("typescript")
    .then((loaded) => {
      // bundlers disagree on whether a CJS namespace keeps its named exports
      const ts = loaded.default ?? loaded;

      return {
        exact: true,
        transpile: (source: string) => {
          const result = ts.transpileModule(source, {
            reportDiagnostics: true,
            compilerOptions: {
              target: ts.ScriptTarget.ES2022,
              module: ts.ModuleKind.ESNext,
              isolatedModules: true,
            },
          });
          const problem = result.diagnostics?.find((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error);
          if (problem) throw new SyntaxError(ts.flattenDiagnosticMessageText(problem.messageText, " "));

          return result.outputText;
        },
      };
    })
    .catch(() => ({ exact: false, transpile: stripTypes }));

  return loading;
}

/**
 * The fallback. It removes whole type declarations and simple annotations,
 * which covers what an example written in the documentation's style contains.
 * Anything it cannot handle becomes a syntax error, and a syntax error from
 * this path is reported as "not checked" rather than as a wrong example.
 */
function stripTypes(source: string): string {
  return source
    .replace(/^\s*(?:declare\s+)?(?:type|interface)\s[\s\S]*?(?:;|\n\})\s*$/gm, "")
    .replace(/\bsatisfies\s+[A-Za-z_$][\w$.<>[\]|\s,]*(?=[,;)\]}\n])/g, "")
    .replace(/:\s*[A-Za-z_$][\w$.]*(?:<[^<>()=]*>)?(?:\[\])?(?=\s*[=,)])/g, "");
}

self.onmessage = async (event: MessageEvent<ExampleRequest>) => {
  const { id, code } = event.data;

  try {
    const asWritten = await evaluateExample(code, { jit: JIT, transpile: (source) => source });
    if (asWritten?.kind !== "syntax") {
      self.postMessage({ id, failure: asWritten } satisfies ExampleResponse);
      return;
    }

    const { transpile, exact } = await loadTranspiler();
    const compiled = await evaluateExample(code, { jit: JIT, transpile });

    self.postMessage({
      // the fallback stripper cannot tell a broken example from one it failed
      // to strip, so its syntax verdict is not evidence of anything
      id,
      failure: compiled?.kind === "syntax" && !exact ? null : compiled,
    } satisfies ExampleResponse);
  } catch (error) {
    // the runner itself broke, which is not the example's fault
    self.postMessage({ id, failure: null } satisfies ExampleResponse);
    console.error("example worker", error);
  }
};
