import { JIT } from "../../index.js";

/**
 * OpenAPI 3.0 Schema Objects are a constrained subset of JSON Schema, and the
 * differences are exactly where a converter usually leaks. This walks a whole
 * document and asserts the subset rules hold everywhere, rather than checking
 * a handful of keywords on one node.
 */
const FORBIDDEN_IN_OPENAPI_30 = [
  "$schema",
  "$defs",
  "const",
  "prefixItems",
  "examples",
  "contentEncoding",
  "unevaluatedProperties",
  "if",
  "then",
  "else",
] as const;

function walk(node: unknown, visit: (node: Record<string, unknown>, path: string) => void, path = ""): void {
  if (node === null || typeof node !== "object") return;
  if (Array.isArray(node)) {
    node.forEach((item, index) => {
      walk(item, visit, `${path}/${index}`);
    });
    return;
  }

  visit(node as Record<string, unknown>, path);
  for (const [key, value] of Object.entries(node)) walk(value, visit, `${path}/${key}`);
}

describe("OpenAPI 3.0 contract", () => {
  const Address = JIT.object({
    street: JIT.string().min(1),
    zip: JIT.string().regex(/^\d{5}$/),
  }).meta({ title: "Address", description: "Postal address" });

  const Customer = JIT.object({
    id: JIT.number().int32().positive(),
    email: JIT.string().email(),
    website: JIT.string().url().optional(),
    kind: JIT.union(JIT.literal("person"), JIT.literal("company")),
    score: JIT.number().min(0).max(100).multipleOf(0.5),
    nickname: JIT.string().nullable(),
    createdAt: JIT.iso.datetime(),
    address: Address,
    history: JIT.array(JIT.string()).min(1).max(10),
    span: JIT.tuple(JIT.string(), JIT.number()),
    tier: JIT.number().default(1),
  }).meta({ title: "Customer", examples: [{ id: 1 }] });

  const document = JIT.jsonSchema.to(Customer, { target: "openapi-3.0" });

  it("should not emit a keyword the 3.0 subset rejects", () => {
    const offenders: string[] = [];

    walk(document, (node, path) => {
      for (const keyword of FORBIDDEN_IN_OPENAPI_30) {
        if (keyword in node) offenders.push(`${keyword} at /${path}`);
      }
    });

    expect(offenders).toEqual([]);
  });

  it("should spell nullability with the nullable keyword, never a null type", () => {
    const nullTypes: string[] = [];

    walk(document, (node, path) => {
      if (node.type === "null") nullTypes.push(path);
      if (Array.isArray(node.type)) nullTypes.push(path);
    });

    expect(nullTypes).toEqual([]);
    expect(document.properties).toMatchObject({ nickname: { type: "string", nullable: true } });
  });

  it("should use the boolean exclusive form for bounds", () => {
    expect(document.properties).toMatchObject({
      id: { type: "integer", format: "int32", minimum: 0, exclusiveMinimum: true },
      score: { type: "number", minimum: 0, maximum: 100, multipleOf: 0.5 },
    });
  });

  it("should express a single value as a one-member enum", () => {
    expect(document.properties).toMatchObject({
      kind: { anyOf: [{ enum: ["person"] }, { enum: ["company"] }] },
    });
  });

  it("should describe tuples with array-form items and a fixed length", () => {
    expect(document.properties).toMatchObject({
      span: { type: "array", items: [{ type: "string" }, { type: "number" }], minItems: 2, maxItems: 2 },
    });
  });

  it("should keep the documented string formats 3.0 understands", () => {
    expect(document.properties).toMatchObject({
      email: { type: "string", format: "email" },
      website: { type: "string", format: "uri" },
      createdAt: { type: "string", format: "date-time" },
      history: { type: "array", minItems: 1, maxItems: 10, items: { type: "string" } },
    });
  });

  it("should fold examples into the singular keyword", () => {
    expect(document.example).toEqual({ id: 1 });
    expect(document.examples).toBeUndefined();
  });

  it("should carry titles and descriptions through nested objects", () => {
    expect(document).toMatchObject({
      title: "Customer",
      properties: { address: { title: "Address", description: "Postal address" } },
    });
  });

  it("should describe request bodies and responses from the same schema", () => {
    const request = JIT.jsonSchema.to(Customer, { target: "openapi-3.0", io: "input" });
    const response = JIT.jsonSchema.to(Customer, { target: "openapi-3.0" });

    // A defaulted field may be omitted on the way in, never on the way out.
    expect(request.required).not.toContain("tier");
    expect(response.required).toContain("tier");
    expect(request.additionalProperties).toBeUndefined();
    expect(response.additionalProperties).toBe(false);
  });

  it("should keep every produced document JSON-serializable", () => {
    expect(() => JSON.stringify(document)).not.toThrow();
    expect(JSON.parse(JSON.stringify(document))).toEqual(document);
  });

  it("should refuse a type the 3.0 subset cannot carry", () => {
    const WithBigInt = JIT.object({ total: JIT.bigint() });

    expect(() => JIT.jsonSchema.to(WithBigInt, { target: "openapi-3.0" })).toThrow(/bigint/);
  });
});
