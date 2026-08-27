import { Compiler, JIT } from "../../index.js";
import { getArtifact } from "../../runtime/artifact-registry.js";

describe("CQRS joins", () => {
  const Order = JIT.object({ id: JIT.number(), customerId: JIT.string(), total: JIT.number() });
  const Customer = JIT.object({ id: JIT.string(), name: JIT.string() });
  type Order = JIT.Typeof<typeof Order>;
  type Customer = JIT.Typeof<typeof Customer>;

  const orders: Order[] = [
    { id: 1, customerId: "c1", total: 100 },
    { id: 2, customerId: "c2", total: 20 },
    { id: 3, customerId: "missing", total: 70 },
  ];
  const customers: Customer[] = [
    { id: "c1", name: "Ada" },
    { id: "c2", name: "Lin" },
  ];

  function artifactOf(value: object) {
    const artifact = getArtifact(value);
    if (artifact?.kind !== "join-plan") throw new Error("join plan artifact not registered");
    return artifact;
  }

  it("hash-joins each side once and preserves inner multiplicity", () => {
    const join = JIT.cqrs.query(Order).join(Customer).on("customerId", "id");
    const repeated = [...customers, { id: "c1", name: "Grace" }];

    expect(join(orders, repeated)).toEqual([
      { left: orders[0], right: repeated[0] },
      { left: orders[0], right: repeated[2] },
      { left: orders[1], right: repeated[1] },
    ]);
    expectTypeOf(join(orders, customers)).toEqualTypeOf<{ readonly left: Order; readonly right: Customer }[]>();

    const source = Compiler.emitJoinSource(artifactOf(join).plan);
    expect(source.match(/for \(/g)?.length).toBeGreaterThanOrEqual(2);
    expect(source).not.toContain(".find(");
    expect(source).not.toContain(".filter(");
    expect(source).not.toContain(".push(");
    expect(source).not.toContain("Object.keys");
  });

  it("emits one unmatched row for a left join", () => {
    const join = JIT.cqrs.query(Order).join(Customer, "left").on("customerId", "id");
    const result = join(orders, customers);

    expect(result).toEqual([
      { left: orders[0], right: customers[0] },
      { left: orders[1], right: customers[1] },
      { left: orders[2], right: undefined },
    ]);
    expectTypeOf(result).toEqualTypeOf<{ readonly left: Order; readonly right: Customer | undefined }[]>();
  });

  it("answers semi and anti joins without pair allocations", () => {
    const semi = JIT.cqrs.query(Order).join(Customer, "semi").on("customerId", "id");
    const anti = JIT.cqrs.query(Order).join(Customer, "anti").on("customerId", "id");

    expect(semi(orders, customers)).toEqual([orders[0], orders[1]]);
    expect(anti(orders, customers)).toEqual([orders[2]]);
    expectTypeOf(semi(orders, customers)).toEqualTypeOf<Order[]>();
    expectTypeOf(anti(orders, customers)).toEqualTypeOf<Order[]>();
    expect(Compiler.emitJoinSource(artifactOf(semi).plan)).not.toContain("{ left:");
    expect(Compiler.emitJoinSource(artifactOf(anti).plan)).not.toContain("{ left:");
  });

  it("reuses a keyed right-side index", () => {
    const Customers = JIT.array(Customer).keyed("id");
    const join = JIT.cqrs.query(Order).join(Customers).on("customerId", "id");
    const artifact = artifactOf(join);
    const source = Compiler.emitJoinSource(artifact.plan);

    expect(join.explain()).toMatchObject({
      strategy: "IndexedJoin",
      complexity: "O(n + k) expected after cached build",
    });
    expect(join(orders, customers)).toHaveLength(2);
    expect(join(orders, customers)).toHaveLength(2);
    expect(source).toContain("__cachedIndex(right,");
    expect(source).not.toContain("const index = ((value)");
  });

  it("merge-joins compatibly ordered inputs without allocating an index", () => {
    const OrderedOrders = JIT.array(Order).ordered("customerId", "asc");
    const OrderedCustomers = JIT.array(Customer).ordered("id", "asc");
    const join = JIT.cqrs.query(OrderedOrders).join(OrderedCustomers).on("customerId", "id");
    const left: Order[] = [
      { id: 1, customerId: "c1", total: 10 },
      { id: 2, customerId: "c1", total: 20 },
      { id: 3, customerId: "c2", total: 30 },
      { id: 4, customerId: "missing", total: 40 },
    ];
    const right: Customer[] = [
      { id: "c1", name: "Ada" },
      { id: "c1", name: "Grace" },
      { id: "c2", name: "Lin" },
    ];
    const source = Compiler.emitJoinSource(artifactOf(join).plan);

    expect(join.explain()).toMatchObject({ strategy: "MergeJoin", complexity: "O(n + m + k)" });
    expect(join(left, right)).toEqual([
      { left: left[0], right: right[0] },
      { left: left[0], right: right[1] },
      { left: left[1], right: right[0] },
      { left: left[1], right: right[1] },
      { left: left[2], right: right[2] },
    ]);
    expect(source).not.toContain("new Map()");
    expect(source).not.toContain("__cachedIndex");
    expect(source).toContain("while (i < leftLen && j < rightLen)");
  });

  it("preserves left/semi/anti semantics in ascending and descending merge joins", () => {
    const ascendingLeft = JIT.array(Order).ordered("customerId", "asc");
    const ascendingRight = JIT.array(Customer).ordered("id", "asc");
    const leftJoin = JIT.cqrs.query(ascendingLeft).join(ascendingRight, "left").on("customerId", "id");
    const semi = JIT.cqrs.query(ascendingLeft).join(ascendingRight, "semi").on("customerId", "id");
    const anti = JIT.cqrs.query(ascendingLeft).join(ascendingRight, "anti").on("customerId", "id");
    const left = [...orders].sort((a, b) => a.customerId.localeCompare(b.customerId));
    const right = [...customers].sort((a, b) => a.id.localeCompare(b.id));

    expect(leftJoin(left, right)).toEqual([
      { left: left[0], right: right[0] },
      { left: left[1], right: right[1] },
      { left: left[2], right: undefined },
    ]);
    expect(semi(left, right)).toEqual([left[0], left[1]]);
    expect(anti(left, right)).toEqual([left[2]]);

    const descendingLeft = JIT.array(Order).ordered("customerId", "desc");
    const descendingRight = JIT.array(Customer).ordered("id", "desc");
    const descending = JIT.cqrs.query(descendingLeft).join(descendingRight).on("customerId", "id");
    expect(descending([...left].reverse(), [...right].reverse())).toEqual([
      { left: left[1], right: right[1] },
      { left: left[0], right: right[0] },
    ]);
  });

  it("does not select merge when directions or keys disagree", () => {
    const left = JIT.array(Order).ordered("customerId", "asc");
    const wrongDirection = JIT.array(Customer).ordered("id", "desc");
    const wrongKey = JIT.array(Customer).ordered("name", "asc");

    expect(JIT.cqrs.query(left).join(wrongDirection).on("customerId", "id").explain().strategy).toBe("HashJoin");
    expect(JIT.cqrs.query(left).join(wrongKey).on("customerId", "id").explain().strategy).toBe("HashJoin");
  });

  it("agrees with the hash strategy for duplicate, present, absent and boundary keys", () => {
    const left: Order[] = [
      { id: 0, customerId: "a", total: 0 },
      { id: 1, customerId: "b", total: 1 },
      { id: 2, customerId: "b", total: 2 },
      { id: 3, customerId: "d", total: 3 },
      { id: 4, customerId: "z", total: 4 },
    ];
    const right: Customer[] = [
      { id: "a", name: "first" },
      { id: "b", name: "one" },
      { id: "b", name: "two" },
      { id: "y", name: "last" },
    ];
    const orderedLeft = JIT.array(Order).ordered("customerId", "asc");
    const orderedRight = JIT.array(Customer).ordered("id", "asc");

    for (const kind of ["inner", "left", "semi", "anti"] as const) {
      const merge = JIT.cqrs.query(orderedLeft).join(orderedRight, kind).on("customerId", "id");
      const hash = JIT.cqrs.query(Order).join(Customer, kind).on("customerId", "id");

      expect(merge(left, right), kind).toEqual(hash(left, right));
    }
  });

  it("fuses left filters and params before probing the right index", () => {
    const join = JIT.cqrs
      .query(Order)
      .params({ minimum: JIT.number() })
      .where((query, params) => query.gte("total", params.minimum))
      .join(Customer)
      .on("customerId", "id");

    expect(join(orders, customers, { minimum: 50 })).toEqual([{ left: orders[0], right: customers[0] }]);
    expect(Compiler.emitJoinSource(artifactOf(join).plan)).toContain("leftRow.total >= params.minimum");
  });

  it("keeps join semantics in ~query and physical details private", () => {
    const join = JIT.cqrs.query(Order).join(Customer, "anti").on("customerId", "id");
    const standard = JSON.stringify(join["~query"]);

    expect(standard).toContain('"kind":"join"');
    expect(standard).toContain('"join":"anti"');
    expect(standard).not.toContain("HashJoin");
    expect(standard).not.toContain("strategy");
  });

  it("rejects incompatible keys and pre-join materialization", () => {
    expect(() =>
      JIT.cqrs
        .query(Order)
        .join(Customer)
        .on("id", "id" as never)
    ).toThrow(/compatible/i);
    expect(() =>
      JIT.cqrs
        .query(Order)
        .orderBy("id")
        .join(Customer)
        .on("customerId", "id" as never)
    ).toThrow(/join v1 accepts params and where/i);

    const pending = JIT.cqrs.query(Order).join(Customer);
    const invalidTypes = () => {
      // @ts-expect-error total is a number while Customer.id is a string
      pending.on("total", "id");
      // @ts-expect-error missing is not an Order field
      pending.on("missing", "id");
      // @ts-expect-error missing is not a Customer field
      pending.on("customerId", "missing");
    };
    void invalidTypes;
  });

  it("agrees with a nested-loop reference for present, absent and duplicate keys", () => {
    const right = [...customers, { id: "c1", name: "Grace" }];
    const reference = orders.flatMap((left) =>
      right.filter((candidate) => candidate.id === left.customerId).map((candidate) => ({ left, right: candidate }))
    );
    const join = JIT.cqrs.query(Order).join(Customer).on("customerId", "id");

    expect(join(orders, right)).toEqual(reference);
  });
});
