import { Compiler, JIT } from "../../index.js";

describe("lazy query execution", () => {
  const Event = JIT.object({
    id: JIT.number().int32(),
    active: JIT.boolean(),
    score: JIT.number(),
    category: JIT.string(),
    tags: JIT.array(JIT.string()),
  });
  const Events = JIT.array(Event);
  const events: JIT.infer<typeof Events> = [
    { id: 1, active: false, score: 20, category: "a", tags: ["cold"] },
    { id: 2, active: true, score: 90, category: "a", tags: ["hot", "new"] },
    { id: 3, active: true, score: 85, category: "b", tags: ["hot"] },
    { id: 4, active: true, score: 40, category: "b", tags: [] },
    { id: 5, active: true, score: 99, category: "c", tags: ["top"] },
  ];

  it("compiles filter/select/take as an explicit iterator with early termination", () => {
    const query = JIT.query(Events)
      .filter((q) => q.eq("active", true))
      .select("id", "score")
      .take(2);
    const iterate = query.compileIterator();
    const lazy = query.lazy().compile();

    expect([...iterate(events)]).toEqual([
      { id: 2, score: 90 },
      { id: 3, score: 85 },
    ]);
    expect([...lazy(events)]).toEqual([
      { id: 2, score: 90 },
      { id: 3, score: 85 },
    ]);
    expect(query.compile()(events)).toEqual([
      { id: 2, score: 90 },
      { id: 3, score: 85 },
    ]);
    expect(query.explain("generator")).toMatchObject({
      outputMode: "generator",
      materializes: false,
      earlyTermination: true,
      barriers: [],
    });
    expectTypeOf(iterate).toEqualTypeOf<
      (input: Iterable<JIT.infer<typeof Event>>) => IterableIterator<{ readonly id: number; readonly score: number }>
    >();
  });

  it("supports flatMap, drop/takeWhile, unique, chunks, windows, and pairs", () => {
    const tags = JIT.query(Events).flatMap("tags").compileIterator();
    const range = JIT.query(Events)
      .dropWhile((q) => q.lt("score", 80))
      .takeWhile((q) => q.gte("score", 40))
      .compileIterator();
    const unique = JIT.query(Events).unique("category").compileIterator();
    const chunks = JIT.query(Events).select("id").chunk(2).compileIterator();
    const windows = JIT.query(Events).select("id").window(3).compileIterator();
    const pairs = JIT.query(Events).select("id").pairwise().compileIterator();

    expect([...tags(events)]).toEqual(["cold", "hot", "new", "hot", "top"]);
    expect([...range(events)].map((event) => event.id)).toEqual([2, 3, 4, 5]);
    expect([...unique(events)].map((event) => event.id)).toEqual([1, 3, 5]);
    expect([...chunks(events)]).toEqual([[{ id: 1 }, { id: 2 }], [{ id: 3 }, { id: 4 }], [{ id: 5 }]]);
    expect([...windows(events)]).toEqual([
      [{ id: 1 }, { id: 2 }, { id: 3 }],
      [{ id: 2 }, { id: 3 }, { id: 4 }],
      [{ id: 3 }, { id: 4 }, { id: 5 }],
    ]);
    expect([...pairs(events)]).toEqual([
      [{ id: 1 }, { id: 2 }],
      [{ id: 2 }, { id: 3 }],
      [{ id: 3 }, { id: 4 }],
      [{ id: 4 }, { id: 5 }],
    ]);
  });

  it("supports scan, adjacent groups, visitor output, and ordering barriers", () => {
    const balances = JIT.query(Events)
      .scan({ initial: 0, update: (total, event) => total + event.score })
      .compileIterator();
    const groups = JIT.query(Events).groupAdjacentBy("category").compileIterator();
    const ordered = JIT.query(Events).orderBy("score", "desc");
    const visit = JIT.query(Events)
      .filter((q) => q.gt("score", 80))
      .select("id")
      .compileVisitor();
    const ids: number[] = [];

    expect([...balances(events)]).toEqual([20, 110, 195, 235, 334]);
    expect([...groups(events)].map((group) => group.map((event) => event.id))).toEqual([[1, 2], [3, 4], [5]]);
    expect([...ordered.compileIterator()(events)].map((event) => event.id)).toEqual([5, 2, 3, 4, 1]);
    expect(ordered.explain("generator")).toMatchObject({
      materializes: true,
      materializationReason: "global ordering requires complete input",
      barriers: ["orderBy"],
    });
    expect(visit(events, (value) => ids.push(value.id))).toBe(3);
    expect(ids).toEqual([2, 3, 5]);
  });

  it("consumes async iterables with backpressure and awaits async scans", async () => {
    async function* source(): AsyncGenerator<JIT.infer<typeof Event>> {
      for (const event of events) yield event;
    }

    const iterate = JIT.query(Events)
      .filter((q) => q.eq("active", true))
      .scan({ initial: 0, update: async (total, event) => total + event.score })
      .take(2)
      .compileAsyncIterator();
    const output: number[] = [];

    for await (const value of iterate(source())) output.push(value);
    expect(output).toEqual([90, 175]);
  });

  it("emits deterministic import-free iterator source", () => {
    const source = Compiler.emitQueryIteratorSource(Events.schema, {
      nodes: [
        {
          kind: "filter",
          condition: {
            kind: "compare",
            op: "eq",
            left: { kind: "field", key: "active" },
            right: { kind: "literal", value: true },
          },
        },
        { kind: "select:fields", fields: ["id"] },
        { kind: "take", count: 10 },
      ],
      bindings: [],
    });

    expect(source).toContain("function* stage0(input, params)");
    expect(source).toContain("for (let i = 0, len = input.length; i < len; i++)");
    expect(source).toContain("if (!(item.active === true)) continue;");
    expect(source).toMatch(/if \(count\d+\+\+ === 10\) return;/);
    expect(source).not.toContain('from "');
  });
});
