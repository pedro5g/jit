import { Compiler, JIT } from "../../../index.js";

describe("JIT compile cache", () => {
  const User = JIT.object({
    id: JIT.number(),
    name: JIT.string(),
    tags: JIT.array(JIT.string()),
  });
  const Users = JIT.array(User);

  afterEach(() => {
    Compiler.clearCompileCache();
  });

  it("should reuse applied functions per schema for schema-derived compilers", () => {
    expect(Compiler.compileEqual(User.schema)).toBe(Compiler.compileEqual(User.schema));
    expect(Compiler.compileClone(User.schema)).toBe(Compiler.compileClone(User.schema));
    expect(Compiler.compileDiff(User.schema)).toBe(Compiler.compileDiff(User.schema));
    expect(Compiler.compileUpdate(User.schema)).toBe(Compiler.compileUpdate(User.schema));
    expect(Compiler.compileHash(User.schema)).toBe(Compiler.compileHash(User.schema));
  });

  it("should keep different operations and schemas isolated", () => {
    const Other = JIT.object({ id: JIT.number(), name: JIT.string(), tags: JIT.array(JIT.string()) });
    const equal = Compiler.compileEqual(User.schema);

    expect(equal as unknown).not.toBe(Compiler.compileClone(User.schema));
    expect(equal).not.toBe(Compiler.compileEqual(Other.schema));
  });

  it("should bypass the cache when disabled and reset on clearCompileCache", () => {
    const cached = Compiler.compileEqual(User.schema);

    expect(Compiler.compileEqual(User.schema, { cache: false })).not.toBe(cached);
    expect(Compiler.compileEqual(User.schema)).toBe(cached);

    Compiler.clearCompileCache();
    expect(Compiler.compileEqual(User.schema)).not.toBe(cached);
  });

  it("should share the query template but rebind values per compile", () => {
    const program = (age: number) => ({
      nodes: [
        {
          kind: "filter" as const,
          condition: {
            kind: "compare" as const,
            op: "gt" as const,
            left: { kind: "field" as const, key: "age" },
            right: { kind: "binding" as const, name: "__q0" },
          },
        },
      ],
      bindings: [age],
    });
    const People = JIT.array(JIT.object({ id: JIT.number(), age: JIT.number() }));
    const people = [
      { id: 1, age: 10 },
      { id: 2, age: 30 },
      { id: 3, age: 50 },
    ];

    const over20 = Compiler.compileQuery(People.schema, program(20));
    const over40 = Compiler.compileQuery(People.schema, program(40));

    expect(over20).not.toBe(over40);
    expect(over20(people).map((person) => person.id)).toEqual([2, 3]);
    expect(over40(people).map((person) => person.id)).toEqual([3]);
  });

  it("should key query templates by plan shape", () => {
    const People = JIT.array(JIT.object({ id: JIT.number(), age: JIT.number() }));
    const emitSpy = vi.spyOn(globalThis, "Function");
    const filterProgram = {
      nodes: [
        {
          kind: "filter" as const,
          condition: {
            kind: "compare" as const,
            op: "gt" as const,
            left: { kind: "field" as const, key: "age" },
            right: { kind: "binding" as const, name: "__q0" },
          },
        },
      ],
      bindings: [20],
    };

    Compiler.compileQuery(People.schema, filterProgram);
    const parsesAfterFirst = emitSpy.mock.calls.length;

    Compiler.compileQuery(People.schema, { ...filterProgram, bindings: [99] });
    expect(emitSpy.mock.calls.length).toBe(parsesAfterFirst);

    Compiler.compileQuery(People.schema, { nodes: [{ kind: "aggregate", op: "count" }], bindings: [] });
    expect(emitSpy.mock.calls.length).toBeGreaterThan(parsesAfterFirst);

    emitSpy.mockRestore();
  });

  it("should hit the cache through the query builder for repeated compiles", () => {
    const emitSpy = vi.spyOn(globalThis, "Function");
    const builder = JIT.query(Users).filter((q) => q.eq("name", "Ada"));

    builder.compile();
    const parsesAfterFirst = emitSpy.mock.calls.length;

    builder.compile();
    expect(emitSpy.mock.calls.length).toBe(parsesAfterFirst);

    emitSpy.mockRestore();
  });
});
