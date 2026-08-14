import * as fc from "fast-check";
import { Compiler, Errors, JIT } from "../../index.js";

describe("schema-directed JSON decoder", () => {
  const User = JIT.object({
    id: JIT.number().int().positive(),
    name: JIT.string().trim().min(2),
    active: JIT.boolean(),
    role: JIT.enum(["admin", "member"] as const),
    tags: JIT.array(JIT.string().lowercase()).max(3),
    note: JIT.string().optional(),
    plan: JIT.string().default("free"),
  });

  it("emits a real scanner with validation in the same traversal", () => {
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
    expect(emitted.source).toContain("function decode(input)");
    expect(emitted.source).toContain("switch (key)");
    expect(emitted.source).not.toContain("JSON.parse");
  });

  it("reads the complete JSON grammar without delegating escaped values", () => {
    const Payload = JIT.object({
      text: JIT.string(),
      values: JIT.array(JIT.number()),
      nullable: JIT.string().nullable(),
    });
    const decode = Compiler.tryCompileJsonDecoder<unknown>(Payload.schema);
    const json = String.raw`{"text":"quote: \" slash: \\ emoji: \uD83D\uDE80","values":[-0,1.25,6.02e23],"nullable":null}`;

    expect(decode).toBeTypeOf("function");
    expect(decode?.(json)).toEqual(JSON.parse(json));
    expect(() => decode?.('{"text":"bad\\x","values":[],"nullable":null}')).toThrow(SyntaxError);
    expect(() => decode?.('{"text":"ok","values":[01],"nullable":null}')).toThrow(SyntaxError);
    expect(() => decode?.('{"text":"ok","values":[],"nullable":null} trailing')).toThrow(SyntaxError);
  });

  it("collects nested validation issues while continuing to scan", () => {
    const decode = JIT.json.parse(User).validate();

    try {
      decode('{"id":-1.5,"name":"x","active":"yes","role":"root","tags":["A","B","C","D"]}');
      expect.unreachable("decoder should reject the payload");
    } catch (error) {
      expect(error).toBeInstanceOf(Errors.JITValidationError);
      const issues = (error as Errors.JITValidationError).issues;

      expect(issues.map((issue) => issue.path)).toEqual(["id", "id", "name", "active", "role", "tags"]);
      expect(issues.map((issue) => issue.code)).toEqual([
        "not_integer",
        "not_positive",
        "too_small",
        "expected_boolean",
        "invalid_enum",
        "too_big",
      ]);
    }
  });

  it("preserves unknown-key policies and validates catchall values inline", () => {
    const Base = JIT.object({ id: JIT.number() });
    const strict = JIT.json.parse(Base.strict()).validate();
    const loose = JIT.json.parse(Base.loose()).validate();
    const catchall = JIT.json.parse(Base.catchall(JIT.string().min(2))).validate();

    expect(() => strict('{"id":1,"extra":true}')).toThrow(/object contains unknown keys/);
    expect(loose('{"id":1,"extra":true}')).toEqual({ id: 1, extra: true });
    expect(catchall('{"id":1,"label":"ok"}')).toEqual({ id: 1, label: "ok" });
    expect(() => catchall('{"id":1,"label":"x"}')).toThrow(/expected at least 2 characters/);
  });

  it("matches duplicate-key last-write behavior and tuple semantics", () => {
    const LastWrite = JIT.object({ id: JIT.number() });
    const Catchall = JIT.object({ id: JIT.number() }).catchall(JIT.string().min(2));
    const Strict = JIT.object({ id: JIT.number() }).strict();
    const Record = JIT.record(JIT.string(), JIT.number());
    const Tuple = JIT.tuple(JIT.number(), JIT.string().optional(), JIT.boolean());

    expect(JIT.json.parse(LastWrite).validate()('{"id":"invalid","id":2}')).toEqual({
      id: 2,
    });
    expect(JIT.json.parse(Catchall).validate()('{"id":1,"tag":"x","tag":"ok"}')).toEqual({
      id: 1,
      tag: "ok",
    });
    expect(JIT.json.parse(Record).validate()('{"score":"bad","score":2}')).toEqual({ score: 2 });
    try {
      JIT.json.parse(Strict).validate()('{"id":1,"extra":true,"extra":false}');
      expect.unreachable("strict decoder should reject the unknown key");
    } catch (error) {
      expect((error as Errors.JITValidationError).issues).toHaveLength(1);
    }
    expect(JIT.json.parse(Tuple).validate()('[1,"ok",true]')).toEqual([1, "ok", true]);
  });

  it("keeps an explicit compatibility fallback for unsupported semantics", () => {
    const Refined = JIT.object({
      id: JIT.number().refine((value) => value % 2 === 0),
    });
    const emitted = Compiler.emitExecutionPlan(JIT.json.parse(Refined).validate().plan);
    const support = Compiler.jsonDecoderSupport(Refined.schema);

    expect(support).toMatchObject({ supported: false });
    expect(support.reason).toContain("refine");
    expect(emitted.source).toContain("JSON.parse");
  });

  it("differentially matches JSON.parse plus compiled validation", () => {
    const Payload = JIT.object({
      id: JIT.number().int().positive(),
      name: JIT.string().min(2).max(40),
      role: JIT.enum(["admin", "member"] as const),
      scores: JIT.array(JIT.number().int()).max(8),
      profile: JIT.object({ active: JIT.boolean(), note: JIT.string().optional() }),
    });
    const direct = JIT.json.parse(Payload).validate();
    const baseline = JIT.parse(Payload);
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

        expect(direct(json)).toEqual(baseline(JSON.parse(json)));
      }),
      { numRuns: 300 }
    );
  });

  it("differentially implements JSON grammar for arbitrary JSON values", () => {
    const decode = Compiler.tryCompileJsonDecoder<unknown>(JIT.json.value().schema);

    expect(decode).toBeTypeOf("function");
    fc.assert(
      fc.property(fc.jsonValue(), (value) => {
        const json = JSON.stringify(value);

        expect(decode?.(json)).toEqual(JSON.parse(json));
      }),
      { numRuns: 500 }
    );

    expect(() => decode?.('{"overflow":1e999}')).toThrow(/expected a JSON-encodable value/);
  });
});
