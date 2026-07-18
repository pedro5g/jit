import { compileBindings, JIT } from "../generated/jit_compiler.js";
import type { LabCompilerRequest, LabCompilerResponse } from "./worker-types.js";

self.onmessage = (event: MessageEvent<LabCompilerRequest>) => {
  const { id, code, names, options } = event.data;

  try {
    const body = code
      .replace(/^\s*import[^\n]*$/gm, "")
      .replace(/^\s*export\s*\{[^}]*\};?\s*$/gm, "")
      .replace(/\bexport\s+(?=(?:const|let|var|function|class)\b)/g, "");
    const returnBindings = names.map(
      (name) => `${JSON.stringify(name)}: typeof ${name} === "undefined" ? undefined : ${name}`
    );
    const evaluate = new Function("JIT", `"use strict";\n${body}\nreturn { ${returnBindings.join(",")} };`) as (
      jit: typeof JIT
    ) => Record<string, unknown>;
    const result = compileBindings(evaluate(JIT), options);

    self.postMessage({ id, ok: true, result } satisfies LabCompilerResponse);
  } catch (error) {
    self.postMessage({
      id,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    } satisfies LabCompilerResponse);
  }
};
