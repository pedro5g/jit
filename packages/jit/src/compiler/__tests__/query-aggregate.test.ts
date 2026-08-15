import { Compiler, Errors, JIT } from "../../index.js";

describe("JIT compiler query aggregates", () => {
  const Orders = JIT.array(
    JIT.object({
      id: JIT.number(),
      customer: JIT.string(),
      total: JIT.number(),
      status: JIT.string(),
    })
  );

  const orders = [
    { id: 1, customer: "ada", total: 100, status: "paid" },
    { id: 2, customer: "ada", total: 50, status: "pending" },
    { id: 3, customer: "grace", total: 200, status: "paid" },
    { id: 4, customer: "grace", total: 25, status: "paid" },
  ];
  const orderSet = new Set(orders);
  const orderMap = new Map(orders.map((order) => [order.id, order]));

  it("should compile sum with inline accumulation and no allocations", () => {
    const paidTotal = JIT.query(Orders)
      .filter((q) => q.eq("status", "paid"))
      .sum("total");
    const source = Compiler.emitQuerySource(Orders.schema, {
      nodes: [
        {
          kind: "filter",
          condition: {
            kind: "compare",
            op: "eq",
            left: { kind: "field", key: "status" },
            right: { kind: "binding", name: "__q0" },
          },
        },
        { kind: "aggregate", op: "sum", key: "total" },
      ],
      bindings: ["paid"],
    });

    expect(paidTotal(orders)).toBe(325);
    expect(source).toBe(`function query(value) {
  const len = value.length;
  let acc = 0;
  for (let i = 0; i < len; i++) {
    const item = value[i];
    if ((item.status === __q0)) {
      acc = (acc + item.total);
    }
  }
  return acc;
}`);
    expect(source).not.toContain("new Array");
    expect(source).not.toContain(".reduce(");
    expectTypeOf(paidTotal(orders)).toEqualTypeOf<number>();
  });

  it("should compile count, avg, min, and max", () => {
    const paid = (query: { filter: unknown }) => query;
    void paid;
    const countPaid = JIT.query(Orders)
      .filter((q) => q.eq("status", "paid"))
      .count();
    const avgPaid = JIT.query(Orders)
      .filter((q) => q.eq("status", "paid"))
      .avg("total");
    const minPaid = JIT.query(Orders)
      .filter((q) => q.eq("status", "paid"))
      .min("total");
    const maxPaid = JIT.query(Orders)
      .filter((q) => q.eq("status", "paid"))
      .max("total");

    expect(countPaid(orders)).toBe(3);
    expect(avgPaid(orders)).toBeCloseTo(325 / 3);
    expect(minPaid(orders)).toBe(25);
    expect(maxPaid(orders)).toBe(200);
    expectTypeOf(countPaid(orders)).toEqualTypeOf<number>();
    expectTypeOf(avgPaid(orders)).toEqualTypeOf<number | undefined>();
    expectTypeOf(minPaid(orders)).toEqualTypeOf<number | undefined>();
    expectTypeOf(maxPaid(orders)).toEqualTypeOf<number | undefined>();
  });

  it("should return empty-collection fallbacks", () => {
    const sum = JIT.query(Orders).sum("total");
    const count = JIT.query(Orders).count();
    const avg = JIT.query(Orders).avg("total");
    const min = JIT.query(Orders).min("total");
    const max = JIT.query(Orders).max("total");

    expect(sum([])).toBe(0);
    expect(count([])).toBe(0);
    expect(avg([])).toBeUndefined();
    expect(min([])).toBeUndefined();
    expect(max([])).toBeUndefined();
  });

  it("should aggregate over Set and Map collections without conversion", () => {
    const User = Orders.schema.def.element;
    const sumSet = JIT.query(JIT.set(User)).sum("total");
    const countMap = JIT.query(JIT.mapSchema(JIT.number(), User))
      .filter((q) => q.eq("status", "paid"))
      .count();
    const setSource = Compiler.emitQuerySource(JIT.set(User).schema, {
      nodes: [{ kind: "aggregate", op: "sum", key: "total" }],
      bindings: [],
    });

    expect(sumSet(orderSet)).toBe(375);
    expect(countMap(orderMap)).toBe(3);
    expect(setSource).toContain("for (const item of value)");
    expect(setSource).not.toContain("Array.from");
    expect(setSource).not.toContain("const len");
  });

  it("should respect unique before aggregating", () => {
    const uniqueCustomerCount = JIT.query(Orders).unique("customer").count();

    expect(uniqueCustomerCount(orders)).toBe(2);
  });

  it("should reject aggregate combinations and unknown keys", () => {
    expect(() => JIT.query(Orders).select("total").sum("total")([])).toThrow(Errors.JITError);
    expect(() => JIT.query(Orders).keyed("id").sum("total")([])).toThrow(Errors.JITError);
    expect(() => JIT.query(Orders).orderBy("total").sum("total")([])).toThrow(Errors.JITError);
    expect(() => JIT.query(Orders).sum("missing" as "total")([])).toThrow(Errors.JITError);

    // @ts-expect-error non-numeric fields cannot be summed.
    JIT.query(Orders).sum("customer");
    // @ts-expect-error non-numeric fields have no average.
    JIT.query(Orders).avg("status");
  });
});
