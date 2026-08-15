import { JIT } from "../../index.js";

describe("JIT json schema", () => {
  it("should describe an object with constraints, required keys, and a closed shape", () => {
    const User = JIT.object({
      id: JIT.number().int32().positive(),
      email: JIT.string().email(),
      name: JIT.string().min(2).max(80),
      age: JIT.number().min(0).max(130).optional(),
      role: JIT.union(JIT.literal("admin"), JIT.literal("member")),
      tags: JIT.array(JIT.string()).min(1).max(8),
    });

    expect(JIT.jsonSchema(User)).toEqual({
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

  it("should keep the document in sync with what the validator accepts", () => {
    const Payload = JIT.object({ id: JIT.int(), note: JIT.string().nullable() });
    const document = JIT.jsonSchema(Payload) as {
      properties: { note: { anyOf: readonly unknown[] } };
      additionalProperties: boolean;
    };

    // The validator strips unknown keys, so the document must not promise them.
    expect(document.additionalProperties).toBe(false);
    expect(document.properties.note.anyOf).toEqual([{ type: "string" }, { type: "null" }]);
  });

  it("should carry metadata into the document without touching validation", () => {
    const Port = JIT.number()
      .min(1)
      .max(65535)
      .meta({
        title: "Port",
        description: "TCP port",
        examples: [80, 443],
      });

    expect(JIT.jsonSchema(Port)).toMatchObject({
      type: "number",
      minimum: 1,
      maximum: 65535,
      title: "Port",
      description: "TCP port",
      examples: [80, 443],
    });
    // Metadata is documentation only: the compiled validator is unchanged.
    expect(JIT.validate.is(Port)(80)).toBe(true);
    expect(JIT.validate.is(Port)(0)).toBe(false);
  });

  it("should report a declared default", () => {
    const Retries = JIT.number().default(3);

    expect(JIT.jsonSchema(Retries)).toMatchObject({ type: "number", default: 3 });
  });

  it("should express a recursive schema through $defs instead of looping", () => {
    const Node = JIT.object({
      value: JIT.number(),
      children: JIT.array(JIT.lazy((): never => Node as never)),
    }).meta({ title: "Node" });

    const document = JIT.jsonSchema(Node) as {
      $defs?: Record<string, unknown>;
      $ref?: string;
      properties?: { children: { items: { $ref?: string } } };
    };
    const reference = document.$ref ?? document.properties?.children.items.$ref;

    expect(reference).toMatch(/^#\/\$defs\//);
    expect(Object.keys(document.$defs ?? {})).toHaveLength(1);
    expect(JSON.stringify(document)).toContain('"value"');
  });

  it("should omit the dialect and open the shape when the caller asks", () => {
    const Body = JIT.object({ id: JIT.int() });
    const document = JIT.jsonSchema(Body, { dialect: false, additionalProperties: true });

    expect(document.$schema).toBeUndefined();
    expect(document.additionalProperties).toBe(true);
  });

  it("should return the same frozen document for one schema and option set", () => {
    const User = JIT.object({ id: JIT.int() });

    expect(JIT.jsonSchema(User)).toBe(JIT.jsonSchema(User));
    expect(JIT.jsonSchema(User)).not.toBe(JIT.jsonSchema(User, { dialect: false }));
    expect(Object.isFrozen(JIT.jsonSchema(User))).toBe(true);
  });

  it("should describe collections that JSON cannot hold natively", () => {
    const Sets = JIT.set(JIT.string());
    const Maps = JIT.mapSchema(JIT.string(), JIT.number());

    expect(JIT.jsonSchema(Sets)).toMatchObject({ type: "array", uniqueItems: true });
    expect(JIT.jsonSchema(Maps)).toMatchObject({
      type: "array",
      items: { type: "array", minItems: 2, maxItems: 2 },
    });
  });
});
