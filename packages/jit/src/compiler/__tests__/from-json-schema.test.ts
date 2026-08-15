import { Errors, JIT } from "../../index.js";

describe("JIT json schema — from", () => {
  it("should infer the type from the document literal and compile against it", () => {
    const User = JIT.jsonSchema.from({
      type: "object",
      properties: {
        name: { type: "string" },
        age: { type: "number" },
        nickname: { type: "string" },
      },
      required: ["name", "age"],
    } as const);

    const isUser = JIT.validate.is(User);
    const parseUser = JIT.validate.parse(User);

    // The document already stated the shape; the type comes from it.
    expectTypeOf(parseUser).returns.toEqualTypeOf<{ name: string; age: number; nickname?: string }>();
    expect(isUser({ name: "Ada", age: 36 })).toBe(true);
    expect(isUser({ name: "Ada", age: 36, nickname: "A" })).toBe(true);
    expect(isUser({ name: "Ada" })).toBe(false);
    expect(isUser({ name: 1, age: 36 })).toBe(false);
  });

  it("should carry constraints into the compiled validator", () => {
    const Account = JIT.jsonSchema.from({
      type: "object",
      properties: {
        email: { type: "string", format: "email" },
        handle: { type: "string", minLength: 3, maxLength: 8, pattern: "^[a-z]+$" },
        credits: { type: "integer", minimum: 0, multipleOf: 5 },
      },
      required: ["email", "handle", "credits"],
    } as const);
    const isAccount = JIT.validate.is(Account);

    expect(isAccount({ email: "ada@example.com", handle: "ada", credits: 10 })).toBe(true);
    expect(isAccount({ email: "nope", handle: "ada", credits: 10 })).toBe(false);
    expect(isAccount({ email: "ada@example.com", handle: "ad", credits: 10 })).toBe(false);
    expect(isAccount({ email: "ada@example.com", handle: "Ada", credits: 10 })).toBe(false);
    expect(isAccount({ email: "ada@example.com", handle: "ada", credits: 7 })).toBe(false);
    expect(isAccount({ email: "ada@example.com", handle: "ada", credits: -5 })).toBe(false);
  });

  it("should read enums, consts, unions and nullability", () => {
    const Role = JIT.jsonSchema.from({ enum: ["admin", "member"] } as const);
    const Kind = JIT.jsonSchema.from({ const: "circle" } as const);
    const Mixed = JIT.jsonSchema.from({ type: ["string", "null"] } as const);
    const Either = JIT.jsonSchema.from({ anyOf: [{ type: "string" }, { type: "number" }] } as const);

    expectTypeOf(JIT.validate.parse(Role)).returns.toEqualTypeOf<"admin" | "member">();
    expectTypeOf(JIT.validate.parse(Kind)).returns.toEqualTypeOf<"circle">();
    expectTypeOf(JIT.validate.parse(Mixed)).returns.toEqualTypeOf<string | null>();
    expectTypeOf(JIT.validate.parse(Either)).returns.toEqualTypeOf<string | number>();

    expect(JIT.validate.is(Role)("admin")).toBe(true);
    expect(JIT.validate.is(Role)("other")).toBe(false);
    expect(JIT.validate.is(Mixed)(null)).toBe(true);
    expect(JIT.validate.is(Either)(1)).toBe(true);
    expect(JIT.validate.is(Either)(true)).toBe(false);
  });

  it("should read arrays, tuples and nested objects", () => {
    const Order = JIT.jsonSchema.from({
      type: "object",
      properties: {
        lines: {
          type: "array",
          minItems: 1,
          items: {
            type: "object",
            properties: { sku: { type: "string" }, qty: { type: "integer" } },
            required: ["sku", "qty"],
          },
        },
        span: { type: "array", prefixItems: [{ type: "string" }, { type: "number" }] },
      },
      required: ["lines", "span"],
    } as const);

    expectTypeOf(JIT.validate.parse(Order)).returns.toEqualTypeOf<{
      lines: { sku: string; qty: number }[];
      span: [string, number];
    }>();

    const isOrder = JIT.validate.is(Order);

    expect(isOrder({ lines: [{ sku: "a", qty: 1 }], span: ["x", 2] })).toBe(true);
    expect(isOrder({ lines: [], span: ["x", 2] })).toBe(false);
    expect(isOrder({ lines: [{ sku: "a", qty: 1.5 }], span: ["x", 2] })).toBe(false);
  });

  it("should resolve a $ref into the document definitions", () => {
    const Order = JIT.jsonSchema.from({
      type: "object",
      properties: { buyer: { $ref: "#/$defs/Person" }, seller: { $ref: "#/$defs/Person" } },
      required: ["buyer", "seller"],
      $defs: {
        Person: {
          type: "object",
          properties: { name: { type: "string" } },
          required: ["name"],
        },
      },
    } as const);
    const isOrder = JIT.validate.is(Order);

    expect(isOrder({ buyer: { name: "Ada" }, seller: { name: "Grace" } })).toBe(true);
    expect(isOrder({ buyer: { name: 1 }, seller: { name: "Grace" } })).toBe(false);
  });

  it("should build a recursive document without looping", () => {
    // Schema construction terminates through a lazy back-edge. Compiling a
    // validator for a self-referencing schema is a separate, still-open gap
    // in the validator emitter, so this asserts construction only.
    const build = () =>
      JIT.jsonSchema.from({
        $ref: "#/$defs/Node",
        $defs: {
          Node: {
            type: "object",
            properties: { value: { type: "number" }, children: { type: "array", items: { $ref: "#/$defs/Node" } } },
            required: ["value"],
          },
        },
      } as const);

    expect(build).not.toThrow();

    // The back-edge is a lazy node, which is what keeps construction finite.
    const hasLazy = (value: unknown, depth = 0): boolean => {
      if (depth > 8 || value === null || typeof value !== "object") return false;
      if ((value as { type?: unknown }).type === "lazy") return true;
      return Object.values(value as Record<string, unknown>).some((child) => hasLazy(child, depth + 1));
    };

    expect(build().schema.type).toBe("object");
    expect(hasLazy(build().schema)).toBe(true);
  });

  it("should reject an unresolvable reference instead of guessing", () => {
    expect(() => JIT.jsonSchema.from({ $ref: "#/$defs/Missing" } as const)).toThrow(/was not found/);
    expect(() => JIT.jsonSchema.from({ $ref: "https://example.com/User" } as const)).toThrow(/external \$ref/);
  });

  it("should let refine add what the document could not say", () => {
    const Even = JIT.jsonSchema.from(
      { type: "object", properties: { n: { type: "integer" } }, required: ["n"] } as const,
      {
        refine: ({ node, schema }) =>
          node.type === "integer"
            ? JIT.custom<number>((value) => typeof value === "number" && value % 2 === 0, "must be even").schema
            : schema,
      }
    );
    const isEven = JIT.validate.is(Even);

    expect(isEven({ n: 4 })).toBe(true);
    expect(isEven({ n: 5 })).toBe(false);
  });

  it("should refuse a document it would silently weaken", () => {
    const document = { type: "string", contentSchema: { type: "number" } } as const;

    expect(() => JIT.jsonSchema.from(document, { unknownKeywords: "throw" })).toThrow(Errors.JITError);
    expect(() => JIT.jsonSchema.from(document, { unknownKeywords: "throw" })).toThrow(/contentSchema/);
    // The default keeps the structural shape it does understand.
    expect(JIT.validate.is(JIT.jsonSchema.from(document))("ok")).toBe(true);
  });

  it("should round-trip a document through a schema and back", () => {
    const document = {
      type: "object",
      properties: { id: { type: "integer" }, tags: { type: "array", items: { type: "string" } } },
      required: ["id", "tags"],
      additionalProperties: false,
    } as const;

    const rebuilt = JIT.jsonSchema.to(JIT.jsonSchema.from(document), { dialect: false });

    expect(rebuilt).toEqual(document);
  });
});
