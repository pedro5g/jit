import { AST, type Errors, JIT } from "../../index.js";

describe("runtime operation facade", () => {
  const User = JIT.object({
    id: JIT.number().int().positive(),
    name: JIT.string().trim().min(2),
    role: JIT.enum(["admin", "member"] as const),
  });
  const ada = { id: 1, name: "Ada", role: "admin" as const };

  it("should compile validators through the fluent runtime API", () => {
    const isUser = JIT.validate(User).is().compile();
    const parseUser = JIT.validate(User).parse().compile();
    const safeParseUser = JIT.validate(User).safeParse().compile();
    const secondIsUser = JIT.validate(User).is().compile();

    expect(isUser).toBe(secondIsUser);
    expect(isUser.compile()).toBe(isUser);
    expect(isUser(ada)).toBe(true);
    expect(isUser({ ...ada, id: 0 })).toBe(false);
    expect(parseUser({ ...ada, name: "  Ada  " })).toEqual(ada);
    expect(safeParseUser({ ...ada, name: "A" }).success).toBe(false);
    expect(isUser.source).toContain("function is(value)");
    expect(isUser.hash).toMatch(/^fnv1a:/);
    expect(isUser.explain()).toMatchObject({
      operation: "validate.is",
      cache: "identity",
    });

    expectTypeOf(isUser).toMatchTypeOf<(value: unknown) => value is AST.Infer<typeof User>>();
    expectTypeOf(isUser.source).toEqualTypeOf<string>();
    expectTypeOf(isUser.hash).toEqualTypeOf<string>();
  });

  it("should keep equal as a direct callable while supporting compile metadata", () => {
    const equalUser = JIT.equal(User);
    const secondEqualUser = JIT.equal(User).compile();

    expect(equalUser).toBe(secondEqualUser);
    expect(equalUser(ada, { ...ada })).toBe(true);
    expect(equalUser(ada, { ...ada, name: "Grace" })).toBe(false);
    expect(equalUser.compile()).toBe(equalUser);
    expect(equalUser.source).toContain("function equal");
    expect(equalUser.explain().operation).toBe("equal");
  });

  it("should expose clone, diff, and hash as compiled callable operations", () => {
    const cloneUser = JIT.clone(User);
    const diffUser = JIT.diff(User);
    const hashUser = JIT.hash(User);
    const grace = { ...ada, name: "Grace" };

    expect(cloneUser(ada)).toEqual(ada);
    expect(cloneUser(ada)).not.toBe(ada);
    expect(diffUser(ada, grace)).toEqual([{ type: "update", path: ["name"], value: "Grace" }]);
    expect(hashUser(ada)).toBe(hashUser({ ...ada }));
    expect(hashUser(ada)).not.toBe(hashUser(grace));
    expect(cloneUser.compile()).toBe(cloneUser);
    expect(diffUser.explain().operation).toBe("diff");
    expect(hashUser.explain().operation).toBe("hash");
  });

  it("should overload json() for schemas and compiled JSON boundaries", () => {
    const JsonValue = JIT.json();
    const stringifyUser = JIT.json(User).stringify().compile();
    const parseUser = JIT.json(User).parse().compile();
    const json = stringifyUser(ada);

    expect(JsonValue.schema.type).toBe(AST.TypeName.json);
    expect(json).toBe(JSON.stringify(ada));
    expect(parseUser(json)).toEqual(ada);
    expect(stringifyUser.compile()).toBe(stringifyUser);
    expect(stringifyUser.explain().operation).toBe("json.stringify");
    expect(parseUser.explain().operation).toBe("json.parse");
  });

  it("streams validation issues and specialized JSON chunks", () => {
    const Item = JIT.object({ id: JIT.number().int32(), name: JIT.string().min(3) });
    const Items = JIT.array(Item);
    const issues = JIT.validate(Item).issues().compile();
    const stringifyChunks = JIT.json(Items).stringifyChunks({ chunkBytes: 24 }).compile();
    const values = [
      { id: 1, name: "Ada" },
      { id: 2, name: "Grace" },
      { id: 3, name: "Linus" },
    ];
    const chunks = [...stringifyChunks(values)];

    expect([...issues({ id: 1.5, name: "x" })].map((issue) => issue.code)).toEqual(["not_int32", "too_small"]);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.join("")).toBe(JSON.stringify(values));
    expectTypeOf(issues).returns.toEqualTypeOf<IterableIterator<Errors.ValidationIssue>>();
    expectTypeOf(stringifyChunks).toMatchTypeOf<(value: JIT.infer<typeof Items>) => IterableIterator<string>>();
  });

  it("should compile select/map transforms through the fluent facade", () => {
    const toPublicUser = JIT.transform(User)
      .select("id", "name")
      .map("name", (field) => field.lowercase())
      .compile();

    expect(toPublicUser({ ...ada, name: "ADA" })).toEqual({ id: 1, name: "ada" });
    expectTypeOf(toPublicUser).toMatchTypeOf<
      (value: { id: number; name: string; role: "admin" | "member" }) => {
        readonly id: number;
        readonly name: string;
      }
    >();
  });
});
