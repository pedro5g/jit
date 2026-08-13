import { AST, type Errors, JIT } from "../../index.js";

describe("composable capability API", () => {
  const User = JIT.object({
    id: JIT.number().int().positive(),
    name: JIT.string().trim().min(2),
    role: JIT.enum(["admin", "member"] as const),
  });
  const ada = { id: 1, name: "Ada", role: "admin" as const };

  it("shares validation factories between root aliases and the namespace", () => {
    const isUser = JIT.validate.is(User);
    const parseUser = JIT.parse(User);
    const safeParseUser = JIT.safeParse(User);

    expect(JIT.is).toBe(JIT.validate.is);
    expect(JIT.parse).toBe(JIT.validate.parse);
    expect(isUser(ada)).toBe(true);
    expect(parseUser({ ...ada, name: "  Ada  " })).toEqual(ada);
    expect(safeParseUser({ ...ada, name: "A" }).success).toBe(false);
    expect(isUser.plan.stages.map((stage) => stage.kind)).toEqual(["value", "validate"]);
    expect(isUser.compile()).toBe(isUser);

    expectTypeOf(isUser).toMatchTypeOf<(value: unknown) => value is AST.Typeof<typeof User>>();
    expectTypeOf(parseUser).toMatchTypeOf<(value: unknown) => AST.Typeof<typeof User>>();
  });

  it("keeps comparison aliases on the same descriptor factory", () => {
    const equalUser = JIT.equal(User);

    expect(JIT.equal).toBe(JIT.compare.equal);
    expect(equalUser(ada, { ...ada })).toBe(true);
    expect(equalUser(ada, { ...ada, name: "Grace" })).toBe(false);
    expect(equalUser.plan.stages[equalUser.plan.stages.length - 1]).toMatchObject({
      kind: "operation",
      operation: "equal",
    });
  });

  it("separates JSON decoding from validation and composes them lazily", () => {
    const decode = JIT.json.parse(User);
    const parseUser = decode.validate();
    const raw = JSON.stringify({ ...ada, name: " Ada " });

    expect(decode.plan.stages.map((stage) => stage.kind)).toEqual(["json.decode"]);
    expect(parseUser.plan.stages.map((stage) => stage.kind)).toEqual(["json.decode", "validate"]);
    expect(parseUser(raw)).toEqual(ada);
    expect(JIT.json.stringify(User)(ada)).toBe(JSON.stringify(ada));
    expect(JIT.json.value().schema.type).toBe(AST.TypeName.json);
  });

  it("composes collection sources, operators, and sinks through one plan", () => {
    const Users = JIT.array(User);
    const publicUsers = JIT.json
      .parse(Users)
      .validate()
      .filter((query) => query.eq("role", "admin"))
      .select("id", "name")
      .to.json();

    expect(publicUsers.plan.stages.map((stage) => stage.kind)).toEqual([
      "json.decode",
      "validate",
      "query",
      "query",
      "json.encode",
    ]);
    expect(publicUsers(JSON.stringify([ada, { id: 2, name: "Grace", role: "member" }]))).toBe(
      JSON.stringify([{ id: 1, name: "Ada" }])
    );
    expectTypeOf(publicUsers).toMatchTypeOf<(value: string) => string>();
  });

  it("exposes binary boundaries as composable sources and sinks", () => {
    const encode = JIT.binary.encode(User);
    const decode = JIT.binary.decode(User).validate();
    const bytes = encode(ada);

    expect(decode.plan.stages.map((stage) => stage.kind)).toEqual(["binary.decode", "validate"]);
    expect(decode(bytes)).toEqual(ada);
    expectTypeOf(encode).toMatchTypeOf<(value: AST.Typeof<typeof User>) => Uint8Array>();
  });

  it("maps standalone values and batches without Array#map", () => {
    const Entity = JIT.object({ id: JIT.number(), fullName: JIT.string() });
    const Public = JIT.object({ id: JIT.number(), name: JIT.string() });
    const toPublic = JIT.map(Entity, Public, { name: { from: "fullName" } });
    const many = JIT.map.many(Entity, Public, { name: { from: "fullName" } });
    const entity = { id: 1, fullName: "Ada Lovelace" };

    expect(toPublic(entity)).toEqual({ id: 1, name: "Ada Lovelace" });
    expect(many([entity, { id: 2, fullName: "Grace Hopper" }])).toEqual([
      { id: 1, name: "Ada Lovelace" },
      { id: 2, name: "Grace Hopper" },
    ]);
    expect(many.plan.stages[many.plan.stages.length - 1]).toMatchObject({ kind: "map", many: true });
  });

  it("keeps issue and chunk artifacts directly callable", () => {
    const Item = JIT.object({ id: JIT.number().int32(), name: JIT.string().min(3) });
    const issues = JIT.validate.issues(Item);
    const stringifyChunks = JIT.json.stringifyChunks(JIT.array(Item), { chunkBytes: 24 });
    const values = [
      { id: 1, name: "Ada" },
      { id: 2, name: "Grace" },
      { id: 3, name: "Linus" },
    ];

    expect([...issues({ id: 1.5, name: "x" })].map((issue) => issue.code)).toEqual(["not_int32", "too_small"]);
    expect([...stringifyChunks(values)].join("")).toBe(JSON.stringify(values));
    expectTypeOf(issues).returns.toEqualTypeOf<IterableIterator<Errors.ValidationIssue>>();
  });
});
