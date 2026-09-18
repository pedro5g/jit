import { Compiler, JIT } from "../../index.js";

describe("JIT query static empty plans", () => {
  const Users = JIT.array(JIT.object({ id: JIT.number(), age: JIT.number() }));
  const impossible = {
    kind: "compare" as const,
    op: "eq" as const,
    left: { kind: "literal" as const, value: 1 },
    right: { kind: "literal" as const, value: 2 },
  };

  it("specializes empty terminal results without emitting a scan", () => {
    const first = Compiler.emitQuerySource(Users.schema, {
      nodes: [
        { kind: "filter", condition: impossible },
        { kind: "terminal", op: "first" },
      ],
      bindings: [],
    });
    const findIndex = Compiler.emitQuerySource(Users.schema, {
      nodes: [
        { kind: "filter", condition: impossible },
        { kind: "terminal", op: "findIndex" },
      ],
      bindings: [],
    });
    const some = Compiler.emitQuerySource(Users.schema, {
      nodes: [
        { kind: "filter", condition: impossible },
        { kind: "terminal", op: "some" },
      ],
      bindings: [],
    });
    const every = Compiler.emitQuerySource(Users.schema, {
      nodes: [
        { kind: "filter", condition: impossible },
        { kind: "terminal", op: "every" },
      ],
      bindings: [],
    });

    expect(first).toContain("return undefined;");
    expect(findIndex).toContain("return -1;");
    expect(some).toContain("return false;");
    expect(every).toContain("return value.length === 0;");
  });
});
