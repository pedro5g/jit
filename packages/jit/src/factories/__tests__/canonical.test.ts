import { Compiler, JIT } from "../../index.js";

const Meta = JIT.object({ a: JIT.string(), b: JIT.string() });
const Row = JIT.object({ id: JIT.number().int(), name: JIT.string(), meta: Meta });
type Row = JIT.Typeof<typeof Row>;

const inOrder: Row = { id: 1, name: "n", meta: { a: "x", b: "y" } };

describe("JIT.canonical", () => {
  const canonical = JIT.canonical(Row);

  /** The reason the check exists: the common case must allocate nothing. */
  it("returns the same reference when the value is already canonical", () => {
    expect(canonical(inOrder)).toBe(inOrder);
    expect(canonical(inOrder).meta).toBe(inOrder.meta);
  });

  it("rebuilds in the schema's declared order", () => {
    const shuffled = { meta: { a: "x", b: "y" }, name: "n", id: 1 } as Row;
    const result = canonical(shuffled);

    expect(Object.keys(result)).toEqual(["id", "name", "meta"]);
    expect(result).toEqual(inOrder);
  });

  it("rebuilds a nested object that is out of order on its own", () => {
    const nested = { id: 1, name: "n", meta: { b: "y", a: "x" } } as Row;
    const result = canonical(nested);

    expect(Object.keys(result.meta)).toEqual(["a", "b"]);
    expect(result).not.toBe(nested);
  });

  it("keeps a canonical nested object by reference while rebuilding its parent", () => {
    const parentOnly = { name: "n", id: 1, meta: inOrder.meta } as Row;
    const result = canonical(parentOnly);

    expect(result).not.toBe(parentOnly);
    expect(result.meta).toBe(inOrder.meta);
  });

  it("makes two orderings serialize identically", () => {
    const shuffled = { meta: { b: "y", a: "x" }, name: "n", id: 1 } as Row;

    expect(JSON.stringify(canonical(shuffled))).toBe(JSON.stringify(canonical(inOrder)));
  });

  it("passes a non-object through untouched", () => {
    expect(canonical(null as never)).toBeNull();
  });

  describe("generated source", () => {
    it("checks the order before deciding to rebuild", () => {
      const source = Compiler.emitCanonicalSource(Row.schema);

      expect(source).toContain("if (canonical) return value;");
      expect(source).toContain('keys[0] === "id"');
    });

    it("builds one literal in declaration order rather than looping", () => {
      const source = Compiler.emitCanonicalSource(Row.schema);

      expect(source).not.toContain("for (");
      expect(source).not.toContain("sort(");
      expect(source).toContain('"id": value.id,');
    });
  });
});
