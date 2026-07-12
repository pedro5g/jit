import { JIT } from "jit/runtime";

export interface PlaygroundRequest {
  id: number;
  code: string;
  input: string;
}

export interface PlaygroundSuccess {
  id: number;
  ok: true;
  source: string;
  hash: string;
  result: unknown;
  compileMs: number;
  validateMs: number;
}

export interface PlaygroundFailure {
  id: number;
  ok: false;
  error: string;
}

export type PlaygroundResponse = PlaygroundSuccess | PlaygroundFailure;

/**
 * Runs user schema code with JIT in scope (playground guide §16: client-only,
 * inside a terminable worker, never on the server, never logged).
 * The snippet must define a `schema` binding.
 */
self.onmessage = (event: MessageEvent<PlaygroundRequest>) => {
  const { id, code, input } = event.data;

  try {
    const build = new Function(
      "JIT",
      `"use strict";\n${code}\n;return typeof schema === "undefined" ? undefined : schema;`
    );
    const schema = build(JIT);
    if (!schema) {
      throw new Error("define a `schema` binding, e.g. `const schema = JIT.object({ … })`");
    }

    const compileStart = performance.now();
    const is = JIT.validate(schema).is().compile();
    const validator = JIT.validator(schema);
    const compileMs = performance.now() - compileStart;

    let result: unknown = null;
    let validateMs = 0;
    if (input.trim() !== "") {
      const value = JSON.parse(input);
      const validateStart = performance.now();
      result = validator.safeParse(value);
      validateMs = performance.now() - validateStart;
    }

    const response: PlaygroundSuccess = {
      id,
      ok: true,
      source: is.source,
      hash: is.hash,
      result,
      compileMs,
      validateMs,
    };
    self.postMessage(response);
  } catch (error) {
    const response: PlaygroundFailure = {
      id,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
    self.postMessage(response);
  }
};
