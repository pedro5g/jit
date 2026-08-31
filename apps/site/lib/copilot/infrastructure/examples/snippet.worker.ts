/// <reference lib="webworker" />

import { JIT } from "@jit-compiler/jit/runtime";
import ts from "typescript";
import { prepareSnippet } from "./snippet-safety";

interface Request {
  blocks: string[];
}

interface Response {
  ok: boolean;
  error?: string;
}

self.onmessage = async (event: MessageEvent<Request>) => {
  try {
    for (const block of event.data.blocks) {
      const prepared = prepareSnippet(block);
      if (!prepared.ok) throw new Error(prepared.error);

      const javascript = ts.transpileModule(prepared.code, {
        compilerOptions: {
          module: ts.ModuleKind.ESNext,
          target: ts.ScriptTarget.ES2022,
          strict: true,
        },
        reportDiagnostics: true,
      });

      const diagnostic = javascript.diagnostics?.find((entry) => entry.category === ts.DiagnosticCategory.Error);
      if (diagnostic) throw new Error(ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"));

      const run = new Function("JIT", `"use strict"; return (async () => {\n${javascript.outputText}\n})();`);
      await run(JIT);
    }

    self.postMessage({ ok: true } satisfies Response);
  } catch (error) {
    self.postMessage({
      ok: false,
      error: error instanceof Error ? error.message : "The example failed to execute.",
    } satisfies Response);
  }
};
