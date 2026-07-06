import { describe, expect, it } from "vitest";
import * as jit from "../packages/jit/src/index.js";

describe("public surface smoke test", () => {
  it("exposes every public namespace", () => {
    expect(Object.keys(jit).sort()).toEqual(
      ["AOT", "AST", "Builder", "Compiler", "Errors", "JIT", "PipelineAST", "Runtime", "Transform"].sort()
    );
  });

  it("compiles and runs a minimal end-to-end equality check", () => {
    const User = jit.JIT.object({
      id: jit.JIT.number(),
      name: jit.JIT.string(),
    });
    const equal = jit.JIT.compileEqual(User.schema);

    expect(equal({ id: 1, name: "Ada" }, { id: 1, name: "Ada" })).toBe(true);
    expect(equal({ id: 1, name: "Ada" }, { id: 2, name: "Ada" })).toBe(false);
  });
});
