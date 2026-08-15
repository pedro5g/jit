import { Errors, JIT } from "../../index.js";

describe("JIT json schema — to", () => {
  it("should describe an object with constraints, required keys, and a closed shape", () => {
    const User = JIT.object({
      id: JIT.number().int32().positive(),
      email: JIT.string().email(),
      name: JIT.string().min(2).max(80),
      age: JIT.number().min(0).max(130).optional(),
      role: JIT.union(JIT.literal("admin"), JIT.literal("member")),
      tags: JIT.array(JIT.string()).min(1).max(8),
    });

    expect(JIT.jsonSchema.to(User)).toEqual({
      $schema: "https://json-schema.org/draft/2020-12/schema",
      type: "object",
      properties: {
        id: { type: "integer", format: "int32", exclusiveMinimum: 0 },
        email: { type: "string", format: "email" },
        name: { type: "string", minLength: 2, maxLength: 80 },
        age: { type: "number", minimum: 0, maximum: 130 },
        role: { anyOf: [{ const: "admin" }, { const: "member" }] },
        tags: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 8 },
      },
      required: ["id", "email", "name", "role", "tags"],
      additionalProperties: false,
    });
  });

  it("should describe the produced value, and separately the accepted one", () => {
    const Payload = JIT.object({ id: JIT.int(), retries: JIT.number().default(3) });
    const output = JIT.jsonSchema.to(Payload);
    const input = JIT.jsonSchema.to(Payload, { io: "input" });

    // Output: defaults are applied and unknown keys are gone.
    expect(output).toMatchObject({ required: ["id", "retries"], additionalProperties: false });
    // Input: a defaulted field may be omitted and extra keys are tolerated.
    expect(input).toMatchObject({ required: ["id"] });
    expect(input.additionalProperties).toBeUndefined();
  });

  it("should collapse a nullable primitive into one type union", () => {
    expect(JIT.jsonSchema.to(JIT.string().nullable(), { dialect: false })).toEqual({ type: ["string", "null"] });
  });

  describe("targets", () => {
    const Schema = JIT.object({
      kind: JIT.literal("a"),
      score: JIT.number().positive(),
      note: JIT.string().nullable(),
      pair: JIT.tuple(JIT.string(), JIT.number()),
    });

    it("should emit draft 2020-12 keywords by default", () => {
      const document = JIT.jsonSchema.to(Schema);

      expect(document.$schema).toBe("https://json-schema.org/draft/2020-12/schema");
      expect(document.properties).toMatchObject({
        kind: { const: "a" },
        score: { exclusiveMinimum: 0 },
        pair: { prefixItems: [{ type: "string" }, { type: "number" }] },
      });
    });

    it("should emit array-form items for draft-07", () => {
      const document = JIT.jsonSchema.to(Schema, { target: "draft-07" });

      expect(document.$schema).toBe("http://json-schema.org/draft-07/schema#");
      expect(document.properties).toMatchObject({
        kind: { const: "a" },
        pair: { items: [{ type: "string" }, { type: "number" }] },
      });
    });

    it("should use the boolean exclusive form and drop const for draft-04", () => {
      const document = JIT.jsonSchema.to(Schema, { target: "draft-04" });

      expect(document.properties).toMatchObject({
        kind: { enum: ["a"] },
        score: { minimum: 0, exclusiveMinimum: true },
      });
    });

    it("should use nullable and omit $schema for OpenAPI 3.0", () => {
      const document = JIT.jsonSchema.to(Schema, { target: "openapi-3.0" });

      expect(document.$schema).toBeUndefined();
      expect(document.properties).toMatchObject({
        kind: { enum: ["a"] },
        note: { type: "string", nullable: true },
        score: { minimum: 0, exclusiveMinimum: true },
      });
    });

    it("should reject an unknown target", () => {
      expect(() => JIT.jsonSchema.to(Schema, { target: "draft-99" as never })).toThrow(/unknown JSON Schema target/);
    });
  });

  describe("unsupported types", () => {
    const WithSet = JIT.object({ tags: JIT.set(JIT.string()) });

    it("should refuse to describe a type JSON cannot carry", () => {
      expect(() => JIT.jsonSchema.to(WithSet)).toThrow(Errors.JITError);
      expect(() => JIT.jsonSchema.to(WithSet)).toThrow(/Set is not JSON data \(at \/properties\/tags\)/);
    });

    it("should widen to any on request", () => {
      expect(JIT.jsonSchema.to(WithSet, { unsupported: "any" })).toMatchObject({ properties: { tags: {} } });
    });

    it("should let a handler substitute a node and see the failing path", () => {
      const document = JIT.jsonSchema.to(WithSet, {
        unsupported: ({ path, schema }) =>
          schema.type === "set" ? { type: "array", items: { type: "string" }, "x-path": path.join("/") } : "throw",
      });

      expect(document.properties).toMatchObject({
        tags: { type: "array", items: { type: "string" }, "x-path": "properties/tags" },
      });
    });

    it("should describe dates as ISO strings because that is what JIT serializes", () => {
      expect(JIT.jsonSchema.to(JIT.date(), { dialect: false })).toEqual({ type: "string", format: "date-time" });
    });
  });

  describe("cycles and reuse", () => {
    const Node = JIT.object({
      value: JIT.number(),
      children: JIT.array(JIT.lazy((): never => Node as never)),
    }).meta({ title: "Node" });

    it("should break a cycle with $defs", () => {
      const document = JIT.jsonSchema.to(Node) as { $ref?: string; $defs?: Record<string, unknown> };

      expect(document.$ref).toBe("#/$defs/Node");
      expect(Object.keys(document.$defs ?? {})).toEqual(["Node"]);
      expect(JSON.stringify(document)).toContain('"$ref":"#/$defs/Node"');
    });

    it("should refuse a cycle when asked to", () => {
      expect(() => JIT.jsonSchema.to(Node, { cycles: "throw" })).toThrow(/recursive schema/);
    });

    it("should inline a reused schema by default and extract it on request", () => {
      const Name = JIT.string().min(2);
      const Person = JIT.object({ first: Name, last: Name });

      expect(JIT.jsonSchema.to(Person)).toMatchObject({
        properties: { first: { type: "string", minLength: 2 }, last: { type: "string", minLength: 2 } },
      });

      const extracted = JIT.jsonSchema.to(Person, { reused: "ref" }) as {
        properties: Record<string, { $ref?: string }>;
        $defs?: Record<string, unknown>;
      };

      expect(extracted.properties.first.$ref).toBe(extracted.properties.last.$ref);
      expect(Object.keys(extracted.$defs ?? {})).toHaveLength(1);
    });
  });

  describe("metadata and overrides", () => {
    it("should carry metadata without touching validation", () => {
      const Port = JIT.number()
        .min(1)
        .max(65535)
        .meta({
          title: "Port",
          description: "TCP port",
          examples: [80, 443],
        });

      expect(JIT.jsonSchema.to(Port)).toMatchObject({
        type: "number",
        minimum: 1,
        maximum: 65535,
        title: "Port",
        description: "TCP port",
        examples: [80, 443],
      });
      expect(JIT.validate.is(Port)(80)).toBe(true);
      expect(JIT.validate.is(Port)(0)).toBe(false);
    });

    it("should fold examples into the singular keyword for OpenAPI", () => {
      expect(JIT.jsonSchema.to(JIT.number().meta({ examples: [80, 443] }), { target: "openapi-3.0" })).toMatchObject({
        example: 80,
      });
    });

    it("should let custom metadata win over the generated keywords", () => {
      const Stamp = JIT.string().meta({ custom: { format: "my-format", "x-vendor": true } });

      expect(JIT.jsonSchema.to(Stamp, { dialect: false })).toEqual({
        type: "string",
        format: "my-format",
        "x-vendor": true,
      });
    });

    it("should give override the last word over every node", () => {
      const document = JIT.jsonSchema.to(JIT.object({ id: JIT.int() }), {
        override: ({ node, path, target }) => {
          if (path.length === 0) node["x-target"] = target;
          if (node.type === "integer") node.description = "identifier";
        },
      });

      expect(document).toMatchObject({
        "x-target": "draft-2020-12",
        properties: { id: { description: "identifier" } },
      });
    });

    it("should report a declared default", () => {
      expect(JIT.jsonSchema.to(JIT.number().default(3), { dialect: false })).toMatchObject({ default: 3 });
    });
  });

  it("should return the same frozen document for one schema and option set", () => {
    const User = JIT.object({ id: JIT.int() });

    expect(JIT.jsonSchema.to(User)).toBe(JIT.jsonSchema.to(User));
    expect(JIT.jsonSchema.to(User)).not.toBe(JIT.jsonSchema.to(User, { target: "draft-07" }));
    expect(Object.isFrozen(JIT.jsonSchema.to(User))).toBe(true);
  });
});
