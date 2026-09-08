import { describe, expect, it } from "vitest";
import * as jit from "../packages/jit/src/index.js";

describe("public surface smoke test", () => {
  it("exposes every public namespace", () => {
    expect(Object.keys(jit).sort()).toEqual(
      ["AOT", "AST", "Builder", "Compiler", "Errors", "Host", "JIT", "PipelineAST", "Runtime", "Transform"].sort()
    );
  });

  it("compiles and runs a minimal end-to-end equality check", () => {
    const User = jit.JIT.object({
      id: jit.JIT.number(),
      name: jit.JIT.string(),
    });
    const equal = jit.JIT.compare.equal(User);

    expect(equal({ id: 1, name: "Ada" }, { id: 1, name: "Ada" })).toBe(true);
    expect(equal({ id: 1, name: "Ada" }, { id: 2, name: "Ada" })).toBe(false);
  });
});

const { JIT } = jit;

const EntityId = JIT.ddd.uniqueIdentifier(
  JIT.string()
    .uuid()
    .default(() => crypto.randomUUID())
);
const Email = JIT.ddd.valueObject(JIT.string().email());
const userSchema = JIT.object({
  id: EntityId,
  name: JIT.string().min(3).max(100),
  email: Email,
  users: JIT.array(
    JIT.object({
      id: JIT.number(),
      name: JIT.string(),
    })
  ),
});
void userSchema;
