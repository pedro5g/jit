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
});
