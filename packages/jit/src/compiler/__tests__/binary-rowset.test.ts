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
    const binary = Users.binary({ strategy: "exact", memoryLayout: "aligned" });
    const rowset = binary.load(rows);

    expect(rowset.__jitBinaryRowSet).toBe(true);
    expect(rowset.count).toBe(rows.length);
    expect(rowset.bytes.byteLength).toBe(rowset.layout.rowSize * rows.length);
    expect(rowset.layout.fields.map((field) => [field.key, field.kind, field.offset])).toEqual([
      ["id", "int32", 4],
      ["name", "string", 8],
      ["role", "literalUnion", 1],
      ["active", "boolean", 2],
      ["score", "float32", 12],
      ["note", "string", 16],
    ]);
    expect(rowset.layout).toMatchObject({
      rowSize: 20,
      maskBytes: 1,
      alignment: 4,
      paddingBytes: 1,
      memoryLayout: "aligned",
    });
    expect(rowset.int32).toBeInstanceOf(Int32Array);
    expect(rowset.uint32).toBeInstanceOf(Uint32Array);
    expect(rowset.float32).toBeInstanceOf(Float32Array);
    expect(rowset.float64.byteLength).toBe(0);
    expect(rowset.hydrate()).toEqual(rows);
  });

  it("keeps mixed rows packed in auto mode and uses typed views when already aligned", () => {
    const packed = Users.binary({ strategy: "exact" });
    const naturallyAligned = JIT.array(JIT.object({ id: JIT.number().int32(), score: JIT.number().float32() })).binary({
      strategy: "exact",
    });

    expect(packed.layout).toMatchObject({ rowSize: 19, paddingBytes: 0, alignment: 1, memoryLayout: "packed" });
    expect(packed.layout.fields.map((field) => field.access)).toContain("dataView");
    expect(naturallyAligned.layout).toMatchObject({
      rowSize: 8,
      paddingBytes: 0,
      alignment: 4,
      memoryLayout: "aligned",
    });
    expect(naturallyAligned.layout.fields.map((field) => field.access)).toEqual(["int32", "float32"]);
  });

  it("naturally aligns 64-bit fields and rejects misaligned caller memory", () => {
    const Events = JIT.array(
      JIT.object({
        present: JIT.boolean().optional(),
        sequence: JIT.number().int32(),
        createdAt: JIT.date(),
        total: JIT.bigint(),
      })
    );
    const binary = Events.binary({ strategy: "exact", memoryLayout: "aligned" });
    const eventRows = [{ present: true, sequence: 7, createdAt: new Date(1_700_000_000_000), total: 42n }];
    const rowset = binary.load(eventRows);

    expect(binary.layout.fields.map((field) => [field.key, field.offset])).toEqual([
      ["present", 1],
      ["sequence", 4],
      ["createdAt", 8],
      ["total", 16],
    ]);
    expect(binary.layout).toMatchObject({ rowSize: 24, alignment: 8, paddingBytes: 2 });
    expect(rowset.float64).toBeInstanceOf(Float64Array);
    expect(rowset.bigint64).toBeInstanceOf(BigInt64Array);
    expect(rowset.hydrate()).toEqual([
      { present: true, sequence: 7, createdAt: new Date(1_700_000_000_000), total: 42n },
    ]);

    const columnar = Events.binary({ strategy: "exact", memoryLayout: "columnar" }).load(eventRows);

    expect(columnar.float64).toBeInstanceOf(Float64Array);
    expect(columnar.bigint64).toBeInstanceOf(BigInt64Array);
    expect(columnar.hydrate()).toEqual(eventRows);

    const misaligned = new Uint8Array(new ArrayBuffer(128), 1, 96);

    expect(() => Events.binary({ strategy: "static", memoryLayout: "aligned", buffer: misaligned })).toThrow(
      /aligned to 8 bytes/
    );
  });

  it("keeps multi-byte optional masks contiguous in columnar storage", () => {
    const Sparse = JIT.array(
      JIT.object({
        a: JIT.number().int32().optional(),
        b: JIT.number().int32().optional(),
        c: JIT.number().int32().nullish(),
        d: JIT.number().int32().optional(),
        e: JIT.number().int32().optional(),
      })
    );
    const binary = Sparse.binary({ strategy: "exact", memoryLayout: "columnar" });
    const values = [
      { a: 1, b: undefined, c: null, d: 4, e: 5 },
      { a: undefined, b: 2, c: 3, d: undefined, e: undefined },
    ];
    const rowset = binary.load(values);

    expect(binary.layout.maskBytes).toBe(2);
    expect([...rowset.bytes.subarray(0, 4)]).toEqual([146, 2, 40, 0]);
    expect(rowset.hydrate()).toEqual(values);
    expect(Compiler.emitBinaryHydrateSource(binary.layout)).toContain("i * 2 + 1");
  });

  it("loads, hydrates, and queries contiguous typed columns", () => {
    const binary = Users.binary({ strategy: "exact", memoryLayout: "columnar" });
    const rowset = binary.load(rows);
    const findAdmins = JIT.query(rowset)
      .filter((q) => q.and(q.eq("role", "admin"), q.eq("active", true)))
      .select("id", "name", "score")
      .compile();

    expect(binary.layout).toMatchObject({
      rowSize: 19,
      maskBytes: 1,
      alignment: 4,
      paddingBytes: 0,
      memoryLayout: "columnar",
    });
    expect(binary.layout.fields.map((field) => [field.key, field.columnIndex])).toEqual([
      ["id", 2],
      ["name", 3],
      ["role", 0],
      ["active", 1],
      ["score", 4],
      ["note", 5],
    ]);
    expect([...rowset.offsets]).toEqual([4, 8, 3, 7, 11, 15]);
    expect(rowset.bytes.byteLength).toBe(Compiler.getBinaryRowSetByteLength(binary.layout, rows.length));
    expect(binary.load(rows.slice(0, 1)).bytes.byteLength).toBe(20);
    expect(rowset.hydrate()).toEqual(rows);
    expect(findAdmins(rowset)).toEqual([
      { id: 1, name: "Ada", score: 9.5 },
      { id: 4, name: "Margaret", score: 8.75 },
    ]);

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
        { kind: "select:fields", fields: ["id", "score"] },
      ],
      bindings: [],
    });

    expect(source).toContain("const offsets = rowset.offsets;");
    expect(source).toContain("u8[b0 + i]");
    expect(source).toContain("int32[b2 + i]");
    expect(source).toContain("float32[b4 + i]");
    expect(source).not.toContain("b3 =");
    expect(source).not.toContain("b5 =");
    expect(source).not.toContain("rowset.view");
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
    expect(Object.keys(first)).toEqual(Object.keys(exact));

    const fixed = Users.binary({ strategy: "static", capacity: 2 });

    expect(fixed.load(rows.slice(0, 2)).capacity).toBe(2);
    expect(() => fixed.load(rows)).toThrow(RangeError);

    const shape = Object.keys(first);

    first.release();
    expect(Object.keys(first)).toEqual(shape);
    expect(first.bytes.byteLength).toBe(0);
    expect(first.int32.byteLength).toBe(0);

    const columnar = Users.binary({ strategy: "static", memoryLayout: "columnar", capacity: 2 });

    expect(columnar.load(rows.slice(0, 2)).capacity).toBe(2);
    expect(() => columnar.load(rows)).toThrow(RangeError);

    const callerMemory = new Uint8Array(128);
    callerMemory.fill(255);
    const callerDynamic = Users.binary({
      strategy: "dynamic",
      memoryLayout: "columnar",
      buffer: callerMemory.subarray(8),
    });

    expect(callerDynamic.load(rows).hydrate()).toEqual(rows);
    expect([...callerMemory.subarray(0, 8)]).toEqual(new Array(8).fill(255));
  });

  it("queries rowsets directly from byte offsets", () => {
    const binary = Users.binary({ strategy: "exact", memoryLayout: "aligned" });
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
    const binary = Users.binary({ strategy: "exact", memoryLayout: "aligned" });
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

  it("adapts projection-only string storage without weakening string filters", () => {
    const projected = JIT.process(User)
      .binary({ strategy: "exact", memoryLayout: "columnar" })
      .filter((q) => q.eq("role", "admin"))
      .select("id", "name")
      .compile();
    const uniqueRowset = projected.binary.load(rows);
    const name = projected.binary.layout.fields.find((field) => field.key === "name");
    const dictionary = uniqueRowset.dictionaries[name?.dictionaryIndex ?? -1];

    expect(name?.dictionaryMode).toBe("adaptive");
    expect(dictionary.identity).toBe(true);
    expect(dictionary.ids.size).toBe(0);
    expect(projected.query(uniqueRowset)).toEqual([
      { id: 1, name: "Ada" },
      { id: 4, name: "Margaret" },
    ]);

    const repeated = rows.map((row) => ({ ...row, name: "same" }));
    const repeatedRowset = projected.binary.load(repeated);
    const repeatedDictionary = repeatedRowset.dictionaries[name?.dictionaryIndex ?? -1];

    expect(repeatedDictionary.identity).toBe(false);
    expect(repeatedDictionary.ids.size).toBe(1);

    const filtered = JIT.process(User)
      .binary({ strategy: "exact" })
      .filter((q) => q.eq("name", "Ada"))
      .select("id", "name")
      .compile();
    const filteredName = filtered.binary.layout.fields.find((field) => field.key === "name");

    expect(filteredName?.dictionaryMode).toBe("dynamic");
    expect(filtered.execute(rows)).toEqual([{ id: 1, name: "Ada" }]);
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
    const binary = Users.binary({ strategy: "exact", memoryLayout: "aligned" });
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
    expect(source).toContain("u8[o + 1] === p0");
    expect(source).toContain("int32[w + 1]");
    expect(source).toContain("uint32[w + 2]");
    expect(source).not.toContain("rowset.view");
    expect(source).not.toContain("d2 =");
    expect(source).not.toContain("item.role");
  });

  it("emits only typed views and dictionaries touched by a query", () => {
    const binary = Users.binary({ strategy: "exact", memoryLayout: "aligned" });
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
        { kind: "aggregate", op: "count" },
      ],
      bindings: [],
    });

    expect(source).toContain("const u8 = rowset.bytes;");
    expect(source).toContain("const d1 = dictionaries[1];");
    expect(source).not.toContain("rowset.int32");
    expect(source).not.toContain("rowset.uint32");
    expect(source).not.toContain("rowset.float32");
    expect(source).not.toContain("d0 =");
    expect(source).not.toContain("d2 =");
  });
});
