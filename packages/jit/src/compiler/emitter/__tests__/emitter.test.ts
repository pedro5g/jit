import { Compiler, JIT } from "../../../index.js";
import { CodeWriter } from "../code-writer.js";

describe("emitter", () => {
  describe("CodeWriter", () => {
    it("joins lines with newlines and no trailing newline", () => {
      const writer = new CodeWriter();

      writer.line("const a = 1;");
      writer.line("const b = 2;");

      expect(writer.toString()).toBe("const a = 1;\nconst b = 2;");
    });

    it("indents nested blocks by two spaces per level", () => {
      const writer = new CodeWriter();

      writer.line("if (x) {");
      writer.indent(() => {
        writer.line("inner();");
        writer.indent(() => {
          writer.line("deep();");
        });
      });
      writer.line("}");

      expect(writer.toString()).toBe("if (x) {\n  inner();\n    deep();\n}");
    });

    it("emits empty lines for line() without text", () => {
      const writer = new CodeWriter();

      writer.line();
      writer.line("code();");

      expect(writer.toString()).toBe("\ncode();");
    });
  });

  describe("emitEqualSource", () => {
    const User = JIT.object({
      id: JIT.number(),
      name: JIT.string(),
    }).schema;

    it("emits deterministic source for the same schema", () => {
      expect(Compiler.emitEqualSource(User)).toBe(Compiler.emitEqualSource(User));
    });

    it("emits readable, engine-friendly early-return comparisons", () => {
      const source = Compiler.emitEqualSource(User);

      // Predictable generated code: strict comparisons with early returns,
      // no eval/with, no interpolated runtime values.
      expect(source).toContain("return false");
      expect(source).toContain("return true");
      expect(source).not.toContain("eval");
      expect(source).not.toContain("with (");
    });

    it("emits structurally different source for different strategies", () => {
      const Plain = JIT.array(JIT.object({ id: JIT.number(), name: JIT.string() })).schema;
      const Indexed = JIT.array(JIT.object({ id: JIT.number(), name: JIT.string() })).indexBy("id").schema;

      expect(Compiler.emitEqualSource(Plain)).not.toBe(Compiler.emitEqualSource(Indexed));
    });

    it("keeps unsafe keys quoted inside generated source", () => {
      const Weird = JIT.object({
        "has space": JIT.number(),
      }).schema;

      const source = Compiler.emitEqualSource(Weird);

      expect(source).toContain('["has space"]');
    });
  });

  describe("equal over keyed and dynamic containers", () => {
    it("should compare a tuple slot by slot, with no loop", () => {
      const Pair = JIT.tuple(JIT.string(), JIT.number(), JIT.object({ a: JIT.number() }));
      const equal = JIT.compare.equal(Pair);
      const source = Compiler.emitEqualSource(Pair.schema);

      expect(equal(["a", 1, { a: 1 }], ["a", 1, { a: 1 }])).toBe(true);
      expect(equal(["a", 1, { a: 1 }], ["b", 1, { a: 1 }])).toBe(false);
      expect(equal(["a", 1, { a: 1 }], ["a", 1, { a: 2 }])).toBe(false);
      // Known arity means static indices, the same way known keys work.
      expect(source).not.toContain("for (");
      expect(source).toContain("l[0]");
    });

    it("should compare a record by key set and by value", () => {
      const Scores = JIT.record(JIT.string(), JIT.object({ n: JIT.number() }));
      const equal = JIT.compare.equal(Scores);

      expect(equal({ a: { n: 1 }, b: { n: 2 } }, { b: { n: 2 }, a: { n: 1 } })).toBe(true);
      expect(equal({ a: { n: 1 } }, { a: { n: 9 } })).toBe(false);
      expect(equal({ a: { n: 1 } }, { a: { n: 1 }, b: { n: 2 } })).toBe(false);
      expect(equal({ a: { n: 1 }, b: { n: 2 } }, { a: { n: 1 } })).toBe(false);
      // The key count is checked before any value is read.
      expect(Compiler.emitEqualSource(Scores.schema)).toMatch(/len !== rk\.length[\s\S]*for \(/);
    });

    it("should not call two records equal when only their key names differ", () => {
      const Loose = JIT.record(JIT.string(), JIT.number().optional());

      // Equal counts and equal values are not enough: the keys must match.
      expect(JIT.compare.equal(Loose)({ a: undefined }, { b: undefined })).toBe(false);
    });

    it("should compare a set by size then membership", () => {
      const Tags = JIT.set(JIT.string());
      const equal = JIT.compare.equal(Tags);

      expect(equal(new Set(["a", "b"]), new Set(["b", "a"]))).toBe(true);
      expect(equal(new Set(["a"]), new Set(["b"]))).toBe(false);
      expect(equal(new Set(["a"]), new Set(["a", "b"]))).toBe(false);
    });

    it("should compare a map by key identity and structural value", () => {
      const Index = JIT.mapSchema(JIT.string(), JIT.object({ n: JIT.number() }));
      const equal = JIT.compare.equal(Index);

      // Distinct objects with the same shape are equal; the value schema decides.
      expect(equal(new Map([["k", { n: 1 }]]), new Map([["k", { n: 1 }]]))).toBe(true);
      expect(equal(new Map([["k", { n: 1 }]]), new Map([["k", { n: 2 }]]))).toBe(false);
      expect(equal(new Map([["a", { n: 1 }]]), new Map([["b", { n: 1 }]]))).toBe(false);
      expect(
        equal(
          new Map([
            ["a", { n: 1 }],
            ["b", { n: 1 }],
          ]),
          new Map([["a", { n: 1 }]])
        )
      ).toBe(false);
    });

    it("should agree with diff and hash on the same containers", () => {
      const Shape = JIT.object({
        t: JIT.tuple(JIT.string(), JIT.number()),
        r: JIT.record(JIT.string(), JIT.number()),
        s: JIT.set(JIT.string()),
        m: JIT.mapSchema(JIT.string(), JIT.number()),
      });
      const equal = JIT.compare.equal(Shape);
      const diff = JIT.compare.diff(Shape);
      const hash = JIT.compare.hash(Shape);
      const make = (n: number) => ({
        t: ["x", n] as [string, number],
        r: { a: n },
        s: new Set(["z"]),
        m: new Map([["k", n]]),
      });

      for (const [left, right] of [
        [make(1), make(1)],
        [make(1), make(2)],
      ] as const) {
        expect(equal(left, right)).toBe(diff(left, right).length === 0);
      }

      expect(hash(make(1))).toBe(hash(make(1)));
    });
  });
});
