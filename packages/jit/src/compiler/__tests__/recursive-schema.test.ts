import { Compiler, Errors, JIT } from "../../index.js";
import { validation } from "./validation-helper.js";

const Tree = JIT.object({
  value: JIT.number().int(),
  children: JIT.array(JIT.lazy((): never => Tree as never)).optional(),
});

describe("JIT recursive schemas", () => {
  it("should compile a self-referencing schema into a named recursive function", () => {
    const source = Compiler.emitValidatorSource(Tree.schema, { ops: ["is"] });

    // One function that calls itself, not an inlined expansion.
    expect(source).toMatch(/function ir\d+\(value\)/);
    expect(source).toMatch(/if \(!ir\d+\(/);
  });

  it("should accept and reject arbitrarily deep values", () => {
    const validate = validation(Tree);
    const deep = { value: 1, children: [{ value: 2, children: [{ value: 3, children: [] }] }] };

    expect(validate.is(deep)).toBe(true);
    expect(validate.is({ value: 1 })).toBe(true);
    expect(validate.is({ value: 1, children: [{ value: 2.5 }] })).toBe(false);
    expect(validate.is({ value: 1, children: [{ value: 2, children: [{ value: "x" }] }] })).toBe(false);
  });

  it("should parse a deep value and report the path of a deep failure", () => {
    const validate = validation(Tree);
    const good = validate.safeParse({ value: 1, children: [{ value: 2, children: [] }] });

    expect(good.success).toBe(true);

    const bad = validate.safeParse({ value: 1, children: [{ value: 2, children: [{ value: "x" }] }] });

    expect(bad.success).toBe(false);
    if (!bad.success) {
      // The path survives the recursive call rather than resetting at each level.
      expect(bad.issues[0].path).toBe("children[0].children[0].value");
    }
  });

  it("should throw a typed error from parse on a deep failure", () => {
    const parse = JIT.validate.parse(Tree);

    expect(() => parse({ value: 1, children: [{ value: "x" }] })).toThrow(Errors.JITValidationError);
    expect(parse({ value: 1, children: [] })).toEqual({ value: 1, children: [] });
  });

  it("should handle mutual recursion between two schemas", () => {
    const Folder: never = JIT.object({
      name: JIT.string(),
      entries: JIT.array(JIT.lazy((): never => Entry)),
    }) as never;
    const Entry: never = JIT.union(
      JIT.object({ file: JIT.string() }),
      JIT.lazy((): never => Folder)
    ) as never;

    const isFolder = JIT.validate.is(Folder);

    expect(isFolder({ name: "root", entries: [{ file: "a.txt" }] })).toBe(true);
    expect(isFolder({ name: "root", entries: [{ name: "sub", entries: [{ file: "b.txt" }] }] })).toBe(true);
    expect(isFolder({ name: "root", entries: [{ nope: 1 }] })).toBe(false);
  });

  it("should support the operations that lower recursion", () => {
    const value = { value: 1, children: [{ value: 2, children: [] }] };
    const copy = { value: 1, children: [{ value: 2, children: [] }] };

    expect(JIT.compare.hash(Tree)(value as never)).toBe(JIT.compare.hash(Tree)(copy as never));
    expect(JIT.validate.is(Tree)(JIT.mock(Tree)({ seed: 3 }))).toBe(true);
    expect(JIT.jsonSchema.to(Tree)).toHaveProperty("$defs");
  });

  it("should refuse the structural operations that still inline, with a usable message", () => {
    // A stack overflow explains nothing; this names the operation and the
    // ones that do work.
    const value = { value: 1, children: [] } as never;

    // Artifacts lower on first call, so the guard fires there.
    for (const compile of [
      () => JIT.clone(Tree)(value),
      () => JIT.compare.equal(Tree)(value, value),
      () => JIT.compare.diff(Tree)(value, value),
      () => JIT.json.stringify(Tree)(value),
      () => JIT.security.mask(Tree)(value),
    ]) {
      expect(compile).toThrow(Errors.JITError);
      expect(compile).toThrow(/does not support a self-referencing schema yet/);
    }
  });

  it("should not change the generated source of a non-recursive schema", () => {
    const Plain = JIT.object({ id: JIT.number().int(), name: JIT.string().min(2) });
    const source = Compiler.emitValidatorSource(Plain.schema, { ops: ["is"] });

    // No helper is introduced when there is no cycle to break.
    expect(source).not.toMatch(/function ir\d+\(/);
    expect(source).toContain("function is(value)");
  });

  it("should validate a schema built from a recursive JSON Schema document", () => {
    const Node = JIT.jsonSchema.from({
      $ref: "#/$defs/Node",
      $defs: {
        Node: {
          type: "object",
          properties: { value: { type: "integer" }, children: { type: "array", items: { $ref: "#/$defs/Node" } } },
          required: ["value"],
        },
      },
    } as const);
    const isNode = JIT.validate.is(Node);

    expect(isNode({ value: 1, children: [{ value: 2, children: [] }] })).toBe(true);
    expect(isNode({ value: 1, children: [{ value: "x" }] })).toBe(false);
  });
});
