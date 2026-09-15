import fc from "fast-check";
import { Compiler, JIT } from "../../index.js";

describe("quality code generation contracts", () => {
  it("emits deterministic, syntactically valid validator source", () => {
    const schema = JIT.object({ id: JIT.string().email(), count: JIT.number().int() });
    const first = Compiler.emitValidatorSource(schema.schema);
    const second = Compiler.emitValidatorSource(schema.schema);

    expect(first).toBe(second);
    expect(() => new Function(first)).not.toThrow();
  });

  it("escapes hostile property names without changing source determinism", () => {
    fc.assert(
      fc.property(
        fc.constantFrom('quote"', "backslash\\", "line\n", "unicode-✓", "__proto__", "constructor"),
        (key) => {
          const schema = JIT.object({ [key]: JIT.string() });
          const source = Compiler.emitValidatorSource(schema.schema);

          expect(source).toBe(Compiler.emitValidatorSource(schema.schema));
          expect(() => new Function(source)).not.toThrow();
        }
      ),
      { numRuns: 12 }
    );
  });
});
