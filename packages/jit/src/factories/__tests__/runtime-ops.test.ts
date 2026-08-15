import { AST, Compiler, type Errors, JIT } from "../../index.js";

describe("composable capability API", () => {
  const User = JIT.object({
    id: JIT.number().int().positive(),
    name: JIT.string().trim().min(2),
    role: JIT.enum(["admin", "member"] as const),
  });
  const ada = { id: 1, name: "Ada", role: "admin" as const };

  it("does not expose the removed selection facades", () => {
    expect(JIT).not.toHaveProperty("validator");
    expect(JIT).not.toHaveProperty("serializer");
    expect(JIT).not.toHaveProperty("model");
    expect(JIT).not.toHaveProperty("mapper");
    expect(JIT).not.toHaveProperty("compile");
    expectTypeOf<
      Extract<"validator" | "serializer" | "model" | "mapper" | "compile", keyof typeof JIT>
    >().toEqualTypeOf<never>();
  });

  it("reaches every capability through exactly one namespace", () => {
    for (const alias of ["is", "parse", "safeParse", "equal", "diff", "hash", "mask", "sanitize"] as const) {
      expect(JIT, `JIT.${alias} must only exist on its capability namespace`).not.toHaveProperty(alias);
    }
    expectTypeOf<
      Extract<"is" | "parse" | "safeParse" | "equal" | "diff" | "hash" | "mask" | "sanitize", keyof typeof JIT>
    >().toEqualTypeOf<never>();
  });

  it("compiles validation through the validate namespace", () => {
    const isUser = JIT.validate.is(User);
    const parseUser = JIT.validate.parse(User);
    const safeParseUser = JIT.validate.safeParse(User);

    expect(isUser(ada)).toBe(true);
    expect(parseUser({ ...ada, name: "  Ada  " })).toEqual(ada);
    expect(safeParseUser({ ...ada, name: "A" }).success).toBe(false);
    expect(isUser.plan.stages.map((stage) => stage.kind)).toEqual(["value", "validate"]);
    expect(isUser.compile()).toBe(isUser);

    expectTypeOf(isUser).toMatchTypeOf<(value: unknown) => value is AST.Typeof<typeof User>>();
    expectTypeOf(parseUser).toMatchTypeOf<(value: unknown) => AST.Typeof<typeof User>>();
  });

  it("compiles comparison through the compare namespace", () => {
    const equalUser = JIT.compare.equal(User);

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

  it("fuses transforms, updates, security rewrites, queries, and sinks in one runtime program", () => {
    const Input = JIT.object({
      id: JIT.number().int(),
      role: JIT.enum(["admin", "member"] as const),
      name: JIT.string(),
      email: JIT.string().pii("mask"),
      note: JIT.string().sanitize(),
    });
    const Output = JIT.object({
      id: JIT.number().int(),
      role: JIT.enum(["admin", "member"] as const),
      name: JIT.string(),
      email: JIT.string().pii("mask"),
      note: JIT.string().sanitize(),
    });
    const pipeline = JIT.json
      .parse(JIT.array(Input))
      .validate()
      .transform(Output, { name: (name) => name.trim().toUpperCase() })
      .update({ name: "PUBLIC" })
      .sanitize()
      .mask()
      .filter((query) => query.eq("role", "admin"))
      .select("id", "name", "email", "note")
      .to.json();
    const source = Compiler.emitExecutionPlan(pipeline.plan).source;

    expect(pipeline.plan.stages.map((stage) => stage.kind)).toEqual([
      "json.decode",
      "validate",
      "transform",
      "update",
      "security",
      "security",
      "query",
      "query",
      "json.encode",
    ]);
    expect(source).toContain("return function execution(input)");
    expect(source).not.toContain("previous(value)");
    expect(source).toContain("JSON.parse");
    expect(
      pipeline(JSON.stringify([{ id: 1, role: "admin", name: " Ada ", email: "ada@math.org", note: "<b>ok</b>" }]))
    ).toBe(JSON.stringify([{ id: 1, name: "PUBLIC", email: "***.org", note: "ok" }]));
    expectTypeOf(pipeline).toMatchTypeOf<(value: string) => string>();
  });

  it("tracks an explicit transform target and rejects shape-changing transforms", () => {
    const Wire = JIT.object({ id: JIT.number(), name: JIT.string() });
    const Domain = JIT.object({ id: JIT.string(), name: JIT.string() });
    const transformed = JIT.from(Wire).transform(Domain, { id: (id) => String(id) });

    expect(transformed({ id: 1, name: "Ada" })).toEqual({ id: "1", name: "Ada" });
    expect(JIT.validate.parse(Wire).transform(Domain, { id: (id) => String(id) })({ id: 2, name: "Grace" })).toEqual({
      id: "2",
      name: "Grace",
    });
    expect(() => JIT.from(Wire).transform(JIT.object({ id: JIT.string() }), { id: (id) => String(id) })).toThrow(
      /preserve the source object's field set/
    );
    expectTypeOf(transformed).toMatchTypeOf<(value: { id: number; name: string }) => { id: string; name: string }>();
  });

  it("keeps pipeline updates immutable for values and collection elements", () => {
    const User = JIT.object({ id: JIT.number(), profile: JIT.object({ name: JIT.string() }) });
    const value = { id: 1, profile: { name: "Ada" } };
    const updated = JIT.from(User).update({ profile: { name: "Grace" } });
    const updatedMany = JIT.from(JIT.array(User)).update({ profile: { name: "Grace" } });

    expect(updated(value)).toEqual({ id: 1, profile: { name: "Grace" } });
    expect(value).toEqual({ id: 1, profile: { name: "Ada" } });
    expect(updatedMany([value])).toEqual([{ id: 1, profile: { name: "Grace" } }]);
    expect(value.profile.name).toBe("Ada");
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

  it("fuses terminal batch mapping and JSON encoding without a mapped output array", () => {
    const Entity = JIT.object({ id: JIT.number(), fullName: JIT.string() });
    const Public = JIT.object({ id: JIT.number(), name: JIT.string() });
    const encoded = JIT.map.many(Entity, Public, { name: { from: "fullName" } }).to.json();
    const source = Compiler.emitExecutionPlan(encoded.plan).source;

    expect(
      encoded([
        { id: 1, fullName: "Ada" },
        { id: 2, fullName: "Grace" },
      ])
    ).toBe('[{"id":1,"name":"Ada"},{"id":2,"name":"Grace"}]');
    expect(source).toContain("let __json");
    expect(source).toContain(".map(__list");
    expect(source).not.toContain("function many(list)");
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
