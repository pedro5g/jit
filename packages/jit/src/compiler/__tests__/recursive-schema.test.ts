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

  it("should clone a recursive value with every level detached", () => {
    const value = { value: 1, children: [{ value: 2, children: [{ value: 3, children: [] }] }] } as never;
    const copy = JIT.clone(Tree)(value) as { children: { children: unknown[] }[] };
    const original = value as unknown as { children: { children: unknown[] }[] };

    expect(copy).toEqual(value);
    expect(copy.children).not.toBe(original.children);
    expect(copy.children[0].children).not.toBe(original.children[0].children);
  });

  it("should compare recursive values structurally", () => {
    const equal = JIT.compare.equal(Tree);
    const left = { value: 1, children: [{ value: 2, children: [{ value: 3, children: [] }] }] } as never;
    const same = { value: 1, children: [{ value: 2, children: [{ value: 3, children: [] }] }] } as never;
    const deepDiff = { value: 1, children: [{ value: 2, children: [{ value: 4, children: [] }] }] } as never;

    expect(equal(left, same)).toBe(true);
    expect(equal(left, deepDiff)).toBe(false);
  });

  it("should diff a recursive value and keep the real path", () => {
    const left = { value: 1, children: [{ value: 2, children: [{ value: 3, children: [] }] }] } as never;
    const right = { value: 1, children: [{ value: 2, children: [{ value: 9, children: [] }] }] } as never;

    expect(JIT.compare.diff(Tree)(left, right)).toEqual([
      { type: "update", path: ["children", 0, "children", 0, "value"], value: 9 },
    ]);
  });

  it("should serialize a recursive value exactly like JSON", () => {
    const value = { value: 1, children: [{ value: 2, children: [] }] } as never;

    expect(JIT.json.stringify(Tree)(value)).toBe(JSON.stringify(value));
  });

  it("should mask and sanitize at every level of a recursive value", () => {
    const Node: never = JIT.object({
      email: JIT.string().email().pii("mask"),
      bio: JIT.string().sanitize(),
      children: JIT.array(JIT.lazy((): never => Node)).optional(),
    }) as never;
    const value = {
      email: "ada@example.com",
      bio: "<b>hi</b>",
      children: [{ email: "grace@example.com", bio: "<i>x</i>", children: [] }],
    } as never;
    const masked = JIT.security.mask(Node)(value) as { email: string; children: { email: string }[] };
    const cleaned = JIT.security.sanitize(Node)(value) as { bio: string; children: { bio: string }[] };

    expect(masked.email).not.toContain("ada");
    expect(masked.children[0].email).not.toContain("grace");
    expect(cleaned.bio).toBe("hi");
    expect(cleaned.children[0].bio).toBe("x");
  });

  it("should emit one named function per cycle, not an inlined expansion", () => {
    expect(Compiler.emitCloneSource(Tree.schema)).toMatch(/function clone_r\d+\(/);
    expect(Compiler.emitEqualSource(Tree.schema)).toMatch(/function equal_r\d+\(/);
    expect(Compiler.emitDiffSource(Tree.schema)).toMatch(/function diff_r\d+\(/);
    expect(Compiler.emitSerializeSource(Tree.schema)).toMatch(/function stringify_r\d+\(/);
  });

  it("should update a recursive value through a named helper", () => {
    const update = JIT.state.update(Tree).compile();
    const value = { value: 1, children: [{ value: 2, children: [{ value: 3, children: [] }] }] } as never;
    const next = update(value, { children: [{ children: [{ value: 42 }] }] } as never) as {
      children: { children: { value: number }[] }[];
    };

    expect(next.children[0].children[0].value).toBe(42);
    // An empty patch changes nothing, so the original is handed straight back.
    expect(update(value, {} as never)).toBe(value);
    expect(Compiler.emitUpdateSource(Tree.schema)).toMatch(/function update_r\d+\(/);
  });

  it("should round-trip a recursive value through the binary codec", () => {
    const Labelled: never = JIT.object({
      value: JIT.number().int(),
      label: JIT.string(),
      children: JIT.array(JIT.lazy((): never => Labelled)),
    }) as never;
    const codec = JIT.binary.codec(Labelled);
    const value = {
      value: 1,
      label: "root",
      children: [{ value: 2, label: "a", children: [{ value: 3, label: "deep", children: [] }] }],
    } as never;

    expect(codec.decode(codec.encode(value))).toEqual(value);

    const target = new Uint8Array(4096);

    expect(codec.decode(target.subarray(0, codec.encodeInto(value, target)))).toEqual(value);
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
