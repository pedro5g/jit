import { Compiler, JIT } from "../../index.js";
import { getArtifact } from "../../runtime/artifact-registry.js";

describe("CQRS composite aggregate", () => {
  const Order = JIT.object({
    id: JIT.number(),
    customerId: JIT.string(),
    total: JIT.number(),
  });
  type Order = JIT.Typeof<typeof Order>;
  const Orders = JIT.array(Order);

  const rows: Order[] = [
    { id: 1, customerId: "c1", total: 100 },
    { id: 2, customerId: "c1", total: 50 },
    { id: 3, customerId: "c2", total: 25 },
  ];

  function sourceOf(compiled: object): string {
    const artifact = getArtifact(compiled);

    if (artifact?.kind !== "query-plan") throw new Error("query plan artifact not registered");
    return Compiler.emitQuerySource(artifact.schema, artifact.program as never);
  }

  it("answers every reduction from one pass", () => {
    const summary = JIT.cqrs
      .query(Orders)
      .where((query) => query.gt("total", 30))
      .aggregate({
        count: JIT.cqrs.count(),
        revenue: JIT.cqrs.sum("total"),
        average: JIT.cqrs.avg("total"),
        lowest: JIT.cqrs.min("total"),
        highest: JIT.cqrs.max("total"),
      });

    expect(summary(rows)).toEqual({
      count: 2,
      revenue: 150,
      average: 75,
      lowest: 50,
      highest: 100,
    });
    expectTypeOf(summary(rows)).toEqualTypeOf<{
      readonly count: number;
      readonly revenue: number;
      readonly average: number | undefined;
      readonly lowest: number | undefined;
      readonly highest: number | undefined;
    }>();

    const source = sourceOf(summary);

    // One loop, accumulators as locals, one object at the end.
    expect(source.match(/for \(/g)).toHaveLength(1);
    expect(source).not.toContain("new Array");
    expect(source).not.toContain(".push(");
    expect(source).not.toContain("Object.keys");
  });

  it("agrees with the scalar aggregates it replaces", () => {
    const query = () => JIT.cqrs.query(Orders).where((current) => current.gt("total", 30));
    const summary = query().aggregate({
      count: JIT.cqrs.count(),
      revenue: JIT.cqrs.sum("total"),
      average: JIT.cqrs.avg("total"),
      lowest: JIT.cqrs.min("total"),
      highest: JIT.cqrs.max("total"),
    })(rows);

    expect(summary.count).toBe(query().count()(rows));
    expect(summary.revenue).toBe(query().sum("total")(rows));
    expect(summary.average).toBe(query().avg("total")(rows));
    expect(summary.lowest).toBe(query().min("total")(rows));
    expect(summary.highest).toBe(query().max("total")(rows));
  });

  it("reports an empty pass without dividing by zero", () => {
    const summary = JIT.cqrs
      .query(Orders)
      .where((query) => query.gt("total", 9_999))
      .aggregate({
        count: JIT.cqrs.count(),
        revenue: JIT.cqrs.sum("total"),
        average: JIT.cqrs.avg("total"),
        lowest: JIT.cqrs.min("total"),
      });

    expect(summary(rows)).toEqual({
      count: 0,
      revenue: 0,
      average: undefined,
      lowest: undefined,
    });
  });

  it("keeps declaration order in the source and in the result", () => {
    const first = JIT.cqrs.query(Orders).aggregate({
      revenue: JIT.cqrs.sum("total"),
      count: JIT.cqrs.count(),
    });
    const second = JIT.cqrs.query(Orders).aggregate({
      count: JIT.cqrs.count(),
      revenue: JIT.cqrs.sum("total"),
    });

    expect(Object.keys(first(rows))).toEqual(["revenue", "count"]);
    expect(Object.keys(second(rows))).toEqual(["count", "revenue"]);
    // Same declaration, same source, every time.
    expect(sourceOf(first)).toBe(
      sourceOf(
        JIT.cqrs.query(Orders).aggregate({
          revenue: JIT.cqrs.sum("total"),
          count: JIT.cqrs.count(),
        })
      )
    );
    expect(sourceOf(first)).not.toBe(sourceOf(second));
  });

  it("respects unique before accumulating", () => {
    const duplicated: Order[] = [...rows, { id: 1, customerId: "c1", total: 100 }];
    const summary = JIT.cqrs
      .query(Orders)
      .unique("id")
      .aggregate({
        count: JIT.cqrs.count(),
        revenue: JIT.cqrs.sum("total"),
      });

    expect(summary(duplicated)).toEqual({ count: 3, revenue: 175 });
  });

  it("carries the composite into the portable ~query contract", () => {
    const summary = JIT.cqrs.query(Orders).aggregate({
      count: JIT.cqrs.count(),
      revenue: JIT.cqrs.sum("total"),
    });

    expect(summary["~query"].definition.pipeline).toContainEqual({
      kind: "aggregate:composite",
      fields: [
        { name: "count", operation: "count" },
        { name: "revenue", operation: "sum", key: "total" },
      ],
    });
  });

  it("gives every group its own accumulator, never a group array", () => {
    const perCustomer = JIT.cqrs
      .query(Orders)
      .groupBy("customerId")
      .aggregate({
        count: JIT.cqrs.count(),
        total: JIT.cqrs.sum("total"),
        lowest: JIT.cqrs.min("total"),
      });

    expect(perCustomer(rows)).toEqual({
      c1: { count: 2, total: 150, lowest: 50 },
      c2: { count: 1, total: 25, lowest: 25 },
    });
    expectTypeOf(perCustomer(rows)).toEqualTypeOf<
      Record<string, { readonly count: number; readonly total: number; readonly lowest: number | undefined }>
    >();

    const source = sourceOf(perCustomer);

    // One pass, and the accumulator is written straight into the record.
    expect(source.match(/for \(/g)).toHaveLength(1);
    expect(source).toContain("out[collectKey] = group;");
    expect(source).toContain("group = {");
    expect(source).not.toContain("group = [");
    expect(source).not.toContain("new Map()");
    expect(source).not.toContain(".push(");
  });

  it("resolves a grouped average over the groups, not the rows", () => {
    const perCustomer = JIT.cqrs
      .query(Orders)
      .groupBy("customerId")
      .aggregate({
        count: JIT.cqrs.count(),
        average: JIT.cqrs.avg("total"),
      });

    expect(perCustomer(rows)).toEqual({
      c1: { count: 2, average: 75 },
      c2: { count: 1, average: 25 },
    });
    // The internal row counter never reaches the result.
    expect(Object.keys(perCustomer(rows).c1)).toEqual(["count", "average"]);

    const source = sourceOf(perCustomer);

    // Two loops: one over the rows, one over the groups.
    expect(source.match(/for \(/g)).toHaveLength(2);
    expect(source).toContain("for (const entry of acc)");
    expect(source).not.toContain("group = [");
  });

  it("filters before grouping, and drops groups with no matching row", () => {
    const perCustomer = JIT.cqrs
      .query(Orders)
      .where((query) => query.gt("total", 30))
      .groupBy("customerId")
      .aggregate({ count: JIT.cqrs.count(), average: JIT.cqrs.avg("total") });

    expect(perCustomer(rows)).toEqual({ c1: { count: 2, average: 75 } });
    expect(Object.keys(perCustomer(rows))).not.toContain("c2");
  });

  it("agrees with grouping into arrays and reducing them", () => {
    const grouped = JIT.cqrs.query(Orders).groupBy("customerId");
    const aggregated = JIT.cqrs
      .query(Orders)
      .groupBy("customerId")
      .aggregate({
        count: JIT.cqrs.count(),
        total: JIT.cqrs.sum("total"),
        average: JIT.cqrs.avg("total"),
      });
    const byHand = Object.fromEntries(
      Object.entries(grouped(rows)).map(([key, group]) => [
        key,
        {
          count: group.length,
          total: group.reduce((sum, order) => sum + order.total, 0),
          average: group.reduce((sum, order) => sum + order.total, 0) / group.length,
        },
      ])
    );

    expect(aggregated(rows)).toEqual(byHand);
  });

  it("rejects the chains a single reduction cannot answer", () => {
    const count = { count: JIT.cqrs.count() };

    expect(() => JIT.cqrs.query(Orders).orderBy("total").aggregate(count)(rows)).toThrow(/cannot be combined with/i);
    expect(() => JIT.cqrs.query(Orders).select("total").aggregate(count)(rows)).toThrow(/cannot be combined with/i);
    expect(() => JIT.cqrs.query(Orders).aggregate(count).first()(rows)).toThrow(/cannot be combined with/i);
    expect(() => JIT.cqrs.query(Orders).keyed("customerId").aggregate(count)(rows)).toThrow(
      /cannot be combined with keyed/i
    );
    expect(() => JIT.cqrs.query(Orders).aggregate({})(rows)).toThrow(/at least one field/i);
    expect(() => JIT.cqrs.query(Orders).aggregate({ missing: JIT.cqrs.sum("nope") })(rows)).toThrow(/unknown key/i);
  });
});
