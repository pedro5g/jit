import { Compiler, Errors, JIT } from "../../index.js";

describe("binary rowsets", () => {
  const User = JIT.object({
    id: JIT.number().int32(),
    name: JIT.string(),
    role: JIT.union(JIT.literal("admin"), JIT.literal("user"), JIT.literal("blocked")),
    active: JIT.boolean(),
    score: JIT.number().float32(),
    note: JIT.string().optional(),
  });
  const Users = JIT.array(User);
  const rows = [
    { id: 1, name: "Ada", role: "admin" as const, active: true, score: 9.5, note: "root" },
    { id: 2, name: "Grace", role: "user" as const, active: true, score: 7.25, note: undefined },
    { id: 3, name: "Linus", role: "blocked" as const, active: false, score: 2.5, note: "hold" },
    { id: 4, name: "Margaret", role: "admin" as const, active: true, score: 8.75, note: undefined },
  ];

  it("loads flat objects into compact rows and hydrates them back", () => {
    const binary = Users.binary({ strategy: "exact" });
    const rowset = binary.load(rows);

    expect(rowset.__jitBinaryRowSet).toBe(true);
    expect(rowset.count).toBe(rows.length);
    expect(rowset.bytes.byteLength).toBe(rowset.layout.rowSize * rows.length);
    expect(rowset.layout.fields.map((field) => [field.key, field.kind, field.offset])).toEqual([
      ["id", "int32", 1],
      ["name", "string", 5],
      ["role", "literalUnion", 9],
      ["active", "boolean", 10],
      ["score", "float32", 11],
      ["note", "string", 15],
    ]);
    expect(rowset.hydrate()).toEqual(rows);
  });

  it("supports dynamic, static, and exact allocation strategies", () => {
    const dynamic = Users.binary({ strategy: "dynamic", initialBytes: 8 });
    const first = dynamic.load(rows.slice(0, 1));
    const second = dynamic.load(rows);

    expect(first.capacity).toBeGreaterThanOrEqual(1);
    expect(second.capacity).toBeGreaterThanOrEqual(rows.length);

    const exact = Users.binary({ strategy: "exact" }).load(rows.slice(0, 2));

    expect(exact.capacity).toBe(2);
    expect(exact.bytes.byteLength).toBe(exact.layout.rowSize * 2);

    const fixed = Users.binary({ strategy: "static", capacity: 2 });

    expect(fixed.load(rows.slice(0, 2)).capacity).toBe(2);
    expect(() => fixed.load(rows)).toThrow(RangeError);
  });

  it("queries rowsets directly from byte offsets", () => {
    const binary = Users.binary({ strategy: "exact" });
    const rowset = binary.load(rows);
    const findAdmins = JIT.query(rowset)
      .filter((q) => q.and(q.eq("role", "admin"), q.eq("active", true)))
      .select("id", "name", "score")
      .compile();

    expect(findAdmins(rowset)).toEqual([
      { id: 1, name: "Ada", score: 9.5 },
      { id: 4, name: "Margaret", score: 8.75 },
    ]);
  });

  it("handles params and numeric aggregates without hydrating rows", () => {
    const binary = Users.binary({ strategy: "exact" });
    const rowset = binary.load(rows);
    const total = JIT.query(rowset)
      .params({ active: JIT.boolean() })
      .filter((q, params) => q.eq("active", params.active))
      .sum("score")
      .compile();
    const countAdmins = JIT.query(rowset)
      .filter((q) => q.eq("role", q.constant("admin")))
      .count()
      .compile();

    expect(total(rowset, { active: true })).toBe(25.5);
    expect(countAdmins(rowset)).toBe(2);
  });

  it("executes object to bytes to object pipelines through JIT.process", () => {
    const pipeline = JIT.process(User)
      .binary({ strategy: "exact" })
      .filter((q) => q.eq("active", true))
      .select("id", "role")
      .compile();

    expect(pipeline.execute(rows)).toEqual([
      { id: 1, role: "admin" },
      { id: 2, role: "user" },
      { id: 4, role: "admin" },
    ]);
  });

  it("exposes typed binary APIs", () => {
    const binary = Users.binary();
    const rowset = binary.load(rows);
    const query = JIT.query(rowset)
      .filter((q) => q.eq("role", "admin"))
      .select("id", "name")
      .compile();
    const pipeline = JIT.process(User)
      .binary()
      .filter((q) => q.eq("role", "admin"))
      .select("id")
      .compile();

    expectTypeOf(binary).toEqualTypeOf<Compiler.BinaryArray<JIT.infer<typeof User>>>();
    expectTypeOf(rowset).toEqualTypeOf<Compiler.BinaryRowSet<JIT.infer<typeof User>>>();
    expectTypeOf(query).toEqualTypeOf<
      (value: Compiler.BinaryRowSet<JIT.infer<typeof User>>) => { readonly id: number; readonly name: string }[]
    >();
    expectTypeOf(pipeline.execute).toEqualTypeOf<
      (values: readonly JIT.infer<typeof User>[], length?: number) => { readonly id: number }[]
    >();
  });

  it("fails loudly for non-rigid nested shapes", () => {
    const Nested = JIT.array(
      JIT.object({
        id: JIT.number(),
        tags: JIT.array(JIT.string()),
      })
    );

    expect(() => Nested.binary()).toThrow(Errors.JITError);
    expect(() => Nested.binary()).toThrow(/flat scalar object fields/);
  });

  it("emits deterministic loader, hydrator, and byte-query source", () => {
    const binary = Users.binary({ strategy: "exact" });
    const source = Compiler.emitBinaryQuerySource(binary.layout, {
      nodes: [
        {
          kind: "filter",
          condition: {
            kind: "compare",
            op: "eq",
            left: { kind: "field", key: "role" },
            right: { kind: "literal", value: "admin" },
          },
        },
        { kind: "select:fields", fields: ["id", "name"] },
      ],
      bindings: [],
    });

    expect(Compiler.emitBinaryRowSetWriterSource(binary.layout)).toContain("function writeRows");
    expect(Compiler.emitBinaryHydrateSource(binary.layout)).toContain("function hydrate");
    expect(source).toContain('const p0 = d1.ids.get("admin");');
    expect(source).toContain("u8[o + 9] === p0");
    expect(source).not.toContain("item.role");
  });
});
