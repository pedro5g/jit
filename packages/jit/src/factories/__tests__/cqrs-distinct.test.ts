import { Compiler, JIT } from "../../index.js";

describe("CQRS distinct", () => {
  const User = JIT.object({
    id: JIT.number(),
    tenant: JIT.string(),
    name: JIT.string(),
    profile: JIT.object({ active: JIT.boolean() }),
  });
  type User = JIT.Typeof<typeof User>;

  const rows: User[] = [
    { id: 1, tenant: "a", name: "Ada", profile: { active: true } },
    { id: 1, tenant: "a", name: "Other", profile: { active: false } },
    { id: 2, tenant: "a", name: "Lin", profile: { active: true } },
    { id: 1, tenant: "b", name: "Ada", profile: { active: true } },
  ];

  it("keeps the first row for a scalar projected key", () => {
    const distinct = JIT.cqrs.query(User).distinct("id");

    expect(distinct(rows)).toEqual([rows[0], rows[2]]);
    expectTypeOf(distinct(rows)).toEqualTypeOf<User[]>();
    expect(distinct["~query"].definition.pipeline).toContainEqual({
      kind: "distinct",
      fields: ["id"],
    });

    const source = Compiler.emitQuerySource(JIT.array(User).schema, {
      nodes: [{ kind: "distinct", fields: ["id"] }],
      bindings: [],
    });
    expect(source).toContain("const key = item.id");
    expect(source).not.toContain("JSON.stringify");
    expect(source).not.toContain(".filter(");
  });

  it("deduplicates compound primitive keys without allocating tuple keys", () => {
    const distinct = JIT.cqrs.query(User).distinct("tenant", "id");
    expect(distinct(rows)).toEqual([rows[0], rows[2], rows[3]]);

    const source = Compiler.emitQuerySource(JIT.array(User).schema, {
      nodes: [{ kind: "distinct", fields: ["tenant", "id"] }],
      bindings: [],
    });
    expect(source).toContain("let next0 = map.get(key0)");
    expect(source).not.toContain("JSON.stringify");
    expect(source).not.toContain("[item.tenant, item.id]");
  });

  it("uses structural hash with equality confirmation for complete rows", () => {
    const duplicate = {
      id: 1,
      tenant: "a",
      name: "Ada",
      profile: { active: true },
    };
    const distinct = JIT.cqrs.query(User).distinct();
    const result = distinct([rows[0], duplicate, rows[1]]);

    expect(result).toEqual([rows[0], rows[1]]);
    expect(result[0]).toBe(rows[0]);

    const source = Compiler.emitQuerySource(JIT.array(User).schema, {
      nodes: [{ kind: "distinct", fields: [] }],
      bindings: [],
    });
    expect(source).toContain("const hash = __distinctHash(item)");
    expect(source).toContain("__distinctEqual(bucket[i], item)");
    expect(source).not.toContain("JSON.stringify");
  });

  it("does not reuse a stale structural hash across calls", () => {
    const distinct = JIT.cqrs.query(User).distinct();
    const mutable = { id: 1, tenant: "a", name: "before", profile: { active: true } };
    expect(distinct([mutable])).toEqual([mutable]);

    mutable.name = "after";
    expect(distinct([mutable, { ...mutable, profile: { active: true } }])).toEqual([mutable]);
  });

  it("uses adjacent comparison for an already ordered key", () => {
    const Users = JIT.array(User).ordered("id", "asc");
    const source = Compiler.emitQuerySource(Users.schema, {
      nodes: [{ kind: "distinct", fields: ["id"] }],
      bindings: [],
    });

    expect(JIT.cqrs.query(Users).distinct("id")(rows.slice(0, 3))).toEqual([rows[0], rows[2]]);
    expect(source).toContain("state.value === key");
    expect(source).not.toContain("seen.has(key)");
  });

  it("preserves the same semantics for iterator and visitor sinks", () => {
    const query = JIT.cqrs.query(User).distinct("tenant", "id");
    const visited: User[] = [];

    expect([...query.to.iterator()(rows)]).toEqual([rows[0], rows[2], rows[3]]);
    expect(query.to.visitor()(rows, (row) => visited.push(row))).toBe(3);
    expect(visited).toEqual([rows[0], rows[2], rows[3]]);
  });

  it("rejects invalid and non-scalar projected fields", () => {
    // @ts-expect-error unknown schema key
    JIT.cqrs.query(User).distinct("missing");
    expect(() => JIT.cqrs.query(User).distinct("profile")(rows)).toThrow(/scalar/i);
    expect(() => JIT.cqrs.query(User).distinct("id", "id")(rows)).toThrow(/repeats/i);
  });
});
