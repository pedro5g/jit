import * as fc from "fast-check";
import { Compiler, Errors, JIT } from "../../index.js";

describe("native JSON parse execution", () => {
  const User = JIT.object({
    id: JIT.number().int32().positive(),
    name: JIT.string().trim().min(2),
    active: JIT.boolean(),
    role: JIT.enum(["admin", "member"] as const),
    tags: JIT.array(JIT.string().lowercase()).max(3),
    note: JIT.string().optional(),
    plan: JIT.string().default("free"),
  });

  it("lowers parse and validation to native JSON.parse followed by the specialized validator", () => {
    const artifact = JIT.json.parse(User).validate();
    const emitted = Compiler.emitExecutionPlan(artifact.plan);
    const value = artifact(
      String.raw` { "tags": ["ONE", "t\u0077o"], "role": "admin", "active": true, "name": "  Ada  ", "id": 1 } `
    );

    expect(value).toEqual({
      id: 1,
      name: "Ada",
      active: true,
      role: "admin",
      tags: ["one", "two"],
      plan: "free",
    });
    expect(emitted.source).toContain("value = JSON.parse(value)");
    expect(emitted.source.indexOf("value = JSON.parse(value)")).toBeLessThan(
      emitted.source.lastIndexOf(".safeParse(value)")
    );
  });

  it("keeps native syntax behavior and specialized validation errors", () => {
    const parse = JIT.json.parse(User).validate();

    expect(() => parse('{"id":1')).toThrow(SyntaxError);
    expect(() => parse('{"id":"bad","name":"Ada","active":true,"role":"admin","tags":[]}')).toThrow(
      Errors.JITValidationError
    );
  });

  it("emits a bounded canonical warm-up sample in schema key order", () => {
    const sample = Compiler.jsonWarmupSample(JIT.array(User).schema);

    expect(sample).toBeTypeOf("string");
    const parsed = JSON.parse(sample ?? "[]") as readonly Record<string, unknown>[];
    expect(parsed).toHaveLength(2);
    expect(Object.keys(parsed[0])).toEqual(["id", "name", "active", "role", "tags", "note", "plan"]);
  });

  it("primes native parsing exactly once when a runtime parser is compiled", () => {
    const parse = vi.spyOn(JSON, "parse");

    try {
      Compiler.compileJsonParse(User.schema);
      expect(parse).toHaveBeenCalledTimes(2);
    } finally {
      parse.mockRestore();
    }
  });

  it("differentially preserves native JSON values and escape semantics", () => {
    const parse = JIT.json.parse(JIT.json.value());

    fc.assert(
      fc.property(fc.jsonValue(), (value) => {
        const json = JSON.stringify(value);

        expect(parse(json)).toEqual(JSON.parse(json));
      }),
      { numRuns: 500 }
    );
  });

  it("differentially matches native parse plus compiled validation", () => {
    const Payload = JIT.object({
      id: JIT.number().int32().positive(),
      name: JIT.string().min(2).max(40),
      role: JIT.enum(["admin", "member"] as const),
      scores: JIT.array(JIT.number().int()).max(8),
      profile: JIT.object({ active: JIT.boolean(), note: JIT.string().optional() }),
    });
    const direct = JIT.json.parse(Payload).validate();
    const validate = JIT.validate.parse(Payload);
    const values = fc.record({
      id: fc.integer({ min: 1, max: 1_000_000 }),
      name: fc.string({ minLength: 2, maxLength: 40 }),
      role: fc.constantFrom("admin" as const, "member" as const),
      scores: fc.array(fc.integer(), { maxLength: 8 }),
      profile: fc.record({
        active: fc.boolean(),
        note: fc.option(fc.string(), { nil: undefined }),
      }),
    });

    fc.assert(
      fc.property(values, (value) => {
        const json = JSON.stringify(value);

        expect(direct(json)).toEqual(validate(JSON.parse(json)));
      }),
      { numRuns: 500 }
    );
  });

  it("differentially matches native parse followed by validation for arbitrary JSON", () => {
    const Payload = JIT.object({
      id: JIT.number().int32().positive(),
      name: JIT.string().min(2).max(40),
      flags: JIT.array(JIT.boolean()).max(5),
    });
    const direct = JIT.json.parse(Payload).validate();
    const validate = JIT.validate.parse(Payload);

    fc.assert(
      fc.property(fc.jsonValue(), (value) => {
        const json = JSON.stringify(value);

        expect(captureValidation(() => direct(json))).toEqual(captureValidation(() => validate(JSON.parse(json))));
      }),
      { numRuns: 500 }
    );
  });
});

function captureValidation(run: () => unknown): unknown {
  try {
    return { success: true, data: run() };
  } catch (error) {
    if (error instanceof Errors.JITValidationError) return { success: false, issues: error.issues };
    throw error;
  }
}
