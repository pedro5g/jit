import { Compiler, JIT } from "../../index.js";

describe("JIT compiler query IR optimizer", () => {
  const Users = JIT.array(
    JIT.object({
      id: JIT.number(),
      name: JIT.string(),
      age: JIT.number(),
      role: JIT.string(),
    })
  );

  const ada = { id: 1, name: "Ada", age: 37, role: "admin" };
  const grace = { id: 2, name: "Grace", age: 17, role: "user" };
  const edsger = { id: 3, name: "Edsger", age: 40, role: "blocked" };
  const input = [ada, grace, edsger];

  it("should flatten nested and chains into the filter conjunction", () => {
    const query = JIT.query(Users)
      .filter((q) => q.and(q.gt("age", 18), q.neq("role", "blocked")))
      .compile();
    const source = Compiler.emitQuerySource(Users.schema, {
      nodes: [
        {
          kind: "filter",
          condition: {
            kind: "logical",
            op: "and",
            left: compare("gt", "age", "__q0"),
            right: compare("neq", "role", "__q1"),
          },
        },
      ],
      bindings: [18, "blocked"],
    });

    expect(source).toContain("if ((item.age > __q0) && (item.role !== __q1))");
    expect(query(input)).toEqual([ada]);
  });

  it("should deduplicate structurally identical conditions", () => {
    const source = Compiler.emitQuerySource(Users.schema, {
      nodes: [
        { kind: "filter", condition: compare("gt", "age", "__q0") },
        { kind: "filter", condition: compare("gt", "age", "__q0") },
      ],
      bindings: [18],
    });

    expect(source).toContain("if ((item.age > __q0)) {");
    expect(countOccurrences(source, "item.age > __q0")).toBe(1);
  });

  it("should remove double negation and invert equality under not", () => {
    const notEq = JIT.query(Users)
      .filter((q) => q.not(q.eq("role", "blocked")))
      .compile();
    const notEqSource = Compiler.emitQuerySource(Users.schema, {
      nodes: [{ kind: "filter", condition: { kind: "not", inner: compare("eq", "role", "__q0") } }],
      bindings: ["blocked"],
    });
    const doubleNotSource = Compiler.emitQuerySource(Users.schema, {
      nodes: [
        {
          kind: "filter",
          condition: { kind: "not", inner: { kind: "not", inner: compare("gt", "age", "__q0") } },
        },
      ],
      bindings: [18],
    });

    expect(notEqSource).toContain("if ((item.role !== __q0))");
    expect(notEqSource).not.toContain("!(");
    expect(doubleNotSource).toContain("if ((item.age > __q0))");
    expect(notEq(input)).toEqual([ada, grace]);
  });

  it("should apply De Morgan over negated logical chains", () => {
    const source = Compiler.emitQuerySource(Users.schema, {
      nodes: [
        {
          kind: "filter",
          condition: {
            kind: "not",
            inner: {
              kind: "logical",
              op: "and",
              left: compare("eq", "role", "__q0"),
              right: compare("eq", "id", "__q1"),
            },
          },
        },
      ],
      bindings: ["blocked", 3],
    });
    const query = JIT.query(Users)
      .filter((q) => q.not(q.and(q.eq("role", "blocked"), q.eq("id", 3))))
      .compile();

    expect(source).toContain("item.role !== __q0 || item.id !== __q1");
    expect(query(input)).toEqual([ada, grace]);
  });

  it("should keep not over ordered comparisons for NaN safety", () => {
    const source = Compiler.emitQuerySource(Users.schema, {
      nodes: [{ kind: "filter", condition: { kind: "not", inner: compare("gt", "age", "__q0") } }],
      bindings: [18],
    });
    const minors = JIT.query(Users)
      .filter((q) => q.not(q.gt("age", 18)))
      .compile();
    const withNaN = [...input, { id: 4, name: "NaN", age: Number.NaN, role: "user" }];

    expect(source).toContain("!(item.age > __q0)");
    expect(source).not.toContain("item.age <= __q0");
    expect(minors(withNaN).map((user) => user.id)).toEqual([2, 4]);
  });

  it("should order cheap conditions before nested logical chains", () => {
    const source = Compiler.emitQuerySource(Users.schema, {
      nodes: [
        {
          kind: "filter",
          condition: {
            kind: "logical",
            op: "and",
            left: {
              kind: "logical",
              op: "or",
              left: compare("eq", "role", "__q0"),
              right: compare("eq", "role", "__q1"),
            },
            right: compare("eq", "id", "__q2"),
          },
        },
      ],
      bindings: ["admin", "user", 1],
    });

    expect(source).toContain("if ((item.id === __q2) && ((item.role === __q0 || item.role === __q1)))");
  });

  it("should fold boolean literals in conjunctions", () => {
    const source = Compiler.emitQuerySource(Users.schema, {
      nodes: [
        {
          kind: "filter",
          condition: {
            kind: "logical",
            op: "and",
            left: {
              kind: "compare",
              op: "eq",
              left: { kind: "literal", value: true },
              right: { kind: "literal", value: true },
            },
            right: compare("gt", "age", "__q0"),
          },
        },
      ],
      bindings: [18],
    });

    expect(source).toContain("if ((item.age > __q0))");
    expect(source).not.toContain("true === true");
  });

  it("should expose the query optimizer passes in the mandated order", () => {
    expect(Compiler.optimizeQueryIRPasses.map((pass) => pass.name)).toEqual([
      "flattenBlocks",
      "normalizeLogic",
      "reorderConditions",
    ]);
  });
});

function compare(op: "eq" | "neq" | "gt" | "gte" | "lt" | "lte", key: string, binding: string) {
  return {
    kind: "compare" as const,
    op,
    left: { kind: "field" as const, key },
    right: { kind: "binding" as const, name: binding },
  };
}

function countOccurrences(source: string, pattern: string): number {
  return source.split(pattern).length - 1;
}
