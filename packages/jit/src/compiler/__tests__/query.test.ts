import { Compiler, Errors, JIT } from "../../index.js";

describe("JIT compiler query", () => {
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
  const adaDuplicate = { id: 1, name: "Ada v2", age: 38, role: "admin" };
  const input = [ada, grace, edsger, adaDuplicate];
  const inputSet = new Set(input);
  const inputMap = new Map(input.map((item) => [item.id, item]));

  it("should compile typed filter queries", () => {
    const adults = JIT.query(Users)
      .filter((q) => q.gt("age", 18))
      .compile();
    const result = adults(input);
    const source = Compiler.emitQuerySource(Users.schema, {
      nodes: [
        {
          kind: "filter",
          condition: compare("gt", "age", "__q0"),
        },
      ],
      bindings: [18],
    });

    expect(result).toEqual([ada, edsger, adaDuplicate]);
    expect(source).toContain("const out = new Array(len);");
    expect(source).toContain("let j = 0;");
    expect(source).toContain("if ((item.age > __q0))");
    expect(source).toContain("out[j++] = item;");
    expectNoInterpretedArrayOps(source);
    expectTypeOf(result).toEqualTypeOf<
      {
        id: number;
        name: string;
        age: number;
        role: string;
      }[]
    >();
  });

  it("should compile fused filter/select queries through explicit compile", () => {
    const selectAdults = JIT.query(Users)
      .filter((q) => q.and(q.gt("age", 18), q.neq("role", "blocked")))
      .select("name")
      .compile();
    const source = Compiler.emitQuerySource(Users.schema, {
      nodes: [
        {
          kind: "filter",
          condition: compare("gt", "age", "__q0"),
        },
        { kind: "select:fields", fields: ["name"] },
      ],
      bindings: [18],
    });
    const result = selectAdults(input);

    expect(result).toEqual([{ name: "Ada" }, { name: "Ada v2" }]);
    expect(source).toBe(`function query(value) {
  const len = value.length;
  const out = new Array(len);
  let j = 0;
  for (let i = 0; i < len; i++) {
    const item = value[i];
    if ((item.age > __q0)) {
      out[j++] = { "name": item.name };
    }
  }
  out.length = j;
  return out;
}`);
    expectNoInterpretedArrayOps(source);
    expectTypeOf(result).toEqualTypeOf<
      {
        readonly name: string;
      }[]
    >();
  });

  it("should compile filter, unique, and select in one array loop", () => {
    const uniqueAdmins = JIT.query(Users)
      .select("id", "name")
      .filter((q) => q.eq("role", "admin"))
      .unique("id")
      .compile();
    const source = Compiler.emitQuerySource(Users.schema, {
      nodes: [
        { kind: "select:fields", fields: ["id", "name"] },
        {
          kind: "filter",
          condition: compare("eq", "role", "__q0"),
        },
        { kind: "unique", key: "id" },
      ],
      bindings: ["admin"],
    });
    const result = uniqueAdmins(input);

    expect(result).toEqual([{ id: 1, name: "Ada" }]);
    expect(source).toBe(`function query(value) {
  const len = value.length;
  const seen = new Set();
  const out = new Array(len);
  let j = 0;
  for (let i = 0; i < len; i++) {
    const item = value[i];
    if ((item.role === __q0)) {
      const uniqueKey = item.id;
      if (!seen.has(uniqueKey)) {
        seen.add(uniqueKey);
        out[j++] = { "id": item.id, "name": item.name };
      }
    }
  }
  out.length = j;
  return out;
}`);
    expect(countOccurrences(source, "for (let i = 0; i < len; i++)")).toBe(1);
    expectNoInterpretedArrayOps(source);
    expectTypeOf(result).toEqualTypeOf<
      {
        readonly id: number;
        readonly name: string;
      }[]
    >();
  });

  it("should compile keyed collectors with projected values", () => {
    const keyed = JIT.query(Users)
      .filter((q) => q.gt("age", 18))
      .keyed("id")
      .select("name")
      .compile();
    const source = Compiler.emitQuerySource(Users.schema, {
      nodes: [
        {
          kind: "filter",
          condition: compare("gt", "age", "__q0"),
        },
        { kind: "keyed", key: "id" },
        { kind: "select:fields", fields: ["name"] },
      ],
      bindings: [18],
    });
    const result = keyed(input);

    expect(result).toEqual(
      new Map([
        [1, { name: "Ada v2" }],
        [3, { name: "Edsger" }],
      ])
    );
    expect(source).toBe(`function query(value) {
  const len = value.length;
  const out = new Map();
  for (let i = 0; i < len; i++) {
    const item = value[i];
    if ((item.age > __q0)) {
      const collectKey = item.id;
      out.set(collectKey, { "name": item.name });
    }
  }
  return out;
}`);
    expect(source).not.toContain("let j = 0;");
    expectNoInterpretedArrayOps(source);
    expectTypeOf(result).toEqualTypeOf<
      Map<
        number,
        {
          readonly name: string;
        }
      >
    >();
  });

  it("should compile groupBy collectors with projected values", () => {
    const grouped = JIT.query(Users)
      .filter((q) => q.gt("age", 18))
      .groupBy("role")
      .select("id")
      .compile();
    const source = Compiler.emitQuerySource(Users.schema, {
      nodes: [
        {
          kind: "filter",
          condition: compare("gt", "age", "__q0"),
        },
        { kind: "groupBy", key: "role" },
        { kind: "select:fields", fields: ["id"] },
      ],
      bindings: [18],
    });
    const result = grouped(input);

    expect(result.admin).toEqual([{ id: 1 }, { id: 1 }]);
    expect(result.blocked).toEqual([{ id: 3 }]);
    expect(source).toBe(`function query(value) {
  const len = value.length;
  const out = Object.create(null);
  for (let i = 0; i < len; i++) {
    const item = value[i];
    if ((item.age > __q0)) {
      const collectKey = item.role;
      let group = out[collectKey];
      if (group === undefined) {
        group = [];
        out[collectKey] = group;
      }
      group[group.length] = { "id": item.id };
    }
  }
  return out;
}`);
    expect(source).not.toContain("new Map()");
    expectNoInterpretedArrayOps(source);
    expectTypeOf(result).toEqualTypeOf<
      Record<
        string,
        {
          readonly id: number;
        }[]
      >
    >();
  });

  it("should compile orderBy as a final array pass", () => {
    const ordered = JIT.query(Users)
      .filter((q) => q.gt("age", 18))
      .select("name", "age")
      .orderBy("age", "asc")
      .compile();
    const result = ordered(input);
    const source = Compiler.emitQuerySource(Users.schema, {
      nodes: [
        {
          kind: "filter",
          condition: compare("gt", "age", "__q0"),
        },
        { kind: "select:fields", fields: ["name", "age"] },
        { kind: "orderBy", key: "age", direction: "asc" },
      ],
      bindings: [18],
    });

    expect(result).toEqual([
      { name: "Ada", age: 37 },
      { name: "Ada v2", age: 38 },
      { name: "Edsger", age: 40 },
    ]);
    expect(source).toContain("out.sort((left, right) => {");
    expect(source).toContain("const leftValue = left.age;");
    expect(countOccurrences(source, "for (let i = 0; i < len; i++)")).toBe(1);
    expectNoInterpretedArrayOps(source);
    expectTypeOf(result).toEqualTypeOf<
      {
        readonly name: string;
        readonly age: number;
      }[]
    >();
  });

  it("should sort original items before projecting when order key is not selected", () => {
    const orderedNames = JIT.query(Users)
      .filter((q) => q.gt("age", 18))
      .select("name")
      .orderBy("age", "desc")
      .compile();
    const source = Compiler.emitQuerySource(Users.schema, {
      nodes: [
        {
          kind: "filter",
          condition: compare("gt", "age", "__q0"),
        },
        { kind: "select:fields", fields: ["name"] },
        { kind: "orderBy", key: "age", direction: "desc" },
      ],
      bindings: [18],
    });
    const result = orderedNames(input);

    expect(result).toEqual([{ name: "Edsger" }, { name: "Ada v2" }, { name: "Ada" }]);
    expect(source).toBe(`function query(value) {
  const len = value.length;
  const out = new Array(len);
  let j = 0;
  for (let i = 0; i < len; i++) {
    const item = value[i];
    if ((item.age > __q0)) {
      out[j++] = item;
    }
  }
  out.length = j;
  out.sort((left, right) => {
    const leftValue = left.age;
    const rightValue = right.age;
    if (leftValue === rightValue) return 0;
    return leftValue < rightValue ? 1 : -1;
  });
  const projected = new Array(j);
  for (let i = 0; i < j; i++) {
    const item = out[i];
    projected[i] = { "name": item.name };
  }
  return projected;
}`);
    expect(countOccurrences(source, "for (let i = 0;")).toBe(2);
    expectNoInterpretedArrayOps(source);
    expectTypeOf(result).toEqualTypeOf<
      {
        readonly name: string;
      }[]
    >();
  });

  it("should normalize operator priority independent from builder order", () => {
    const query = JIT.query(Users)
      .select("id", "role")
      .unique("id")
      .filter((q) => q.not(q.eq("role", "blocked")))
      .compile();
    const result = query(input);

    expect(result).toEqual([
      { id: 1, role: "admin" },
      { id: 2, role: "user" },
    ]);
    expectTypeOf(result).toEqualTypeOf<
      {
        readonly id: number;
        readonly role: string;
      }[]
    >();
  });

  it("should optimize repeated operations with last operation winning", () => {
    const query = JIT.query(Users)
      .filter((q) => q.gt("age", 10))
      .filter((q) => q.neq("role", "blocked"))
      .select("id", "name", "role")
      .select("name")
      .unique("role")
      .unique("id")
      .orderBy("name", "desc")
      .orderBy("age", "asc")
      .compile();
    const source = Compiler.emitQuerySource(Users.schema, {
      nodes: [
        { kind: "filter", condition: compare("gt", "age", "__q0") },
        { kind: "filter", condition: compare("neq", "role", "__q1") },
        { kind: "select:fields", fields: ["id", "name", "role"] },
        { kind: "select:fields", fields: ["name"] },
        { kind: "unique", key: "role" },
        { kind: "unique", key: "id" },
        { kind: "orderBy", key: "name", direction: "desc" },
        { kind: "orderBy", key: "age", direction: "asc" },
      ],
      bindings: [10, "blocked"],
    });
    const result = query(input);

    expect(result).toEqual([{ name: "Grace" }, { name: "Ada" }]);
    expect(source).toContain("if ((item.age > __q0) && (item.role !== __q1))");
    expect(source).toContain("const uniqueKey = item.id;");
    expect(source).not.toContain("item.role;\n      if (!seen.has");
    expect(source).toContain("const leftValue = left.age;");
    expect(source).not.toContain("const leftValue = left.name;");
    expect(source).toContain('projected[i] = { "name": item.name };');
    expectTypeOf(result).toEqualTypeOf<
      {
        readonly name: string;
      }[]
    >();
  });

  it("should let the last collector win", () => {
    const query = JIT.query(Users).keyed("id").groupBy("role").select("name").compile();
    const source = Compiler.emitQuerySource(Users.schema, {
      nodes: [
        { kind: "keyed", key: "id" },
        { kind: "groupBy", key: "role" },
        { kind: "select:fields", fields: ["name"] },
      ],
      bindings: [],
    });
    const result = query(input);

    expect(result.admin).toEqual([{ name: "Ada" }, { name: "Ada v2" }]);
    expect(result.user).toEqual([{ name: "Grace" }]);
    expect(source).toContain("const out = Object.create(null);");
    expect(source).not.toContain("new Map()");
    expectTypeOf(result).toEqualTypeOf<
      Record<
        string,
        {
          readonly name: string;
        }[]
      >
    >();
  });

  it("should compile Set filter/select queries without array conversion", () => {
    const User = Users.schema.def.element;
    const query = JIT.query(JIT.set(User))
      .filter((q) => q.gt("age", 18))
      .select("name")
      .compile();
    const source = Compiler.emitQuerySource(JIT.set(User).schema, {
      nodes: [
        { kind: "filter", condition: compare("gt", "age", "__q0") },
        { kind: "select:fields", fields: ["name"] },
      ],
      bindings: [18],
    });
    const result = query(inputSet);

    expect(result).toEqual([{ name: "Ada" }, { name: "Edsger" }, { name: "Ada v2" }]);
    expect(source).toContain("const len = value.size;");
    expect(source).toContain("for (const item of value)");
    expect(source).not.toContain("Array.from");
    expectNoInterpretedArrayOps(source);
    expectTypeOf(result).toEqualTypeOf<{ readonly name: string }[]>();
  });

  it("should compile Map value queries without entry destructuring or array conversion", () => {
    const User = Users.schema.def.element;
    const query = JIT.query(JIT.map(JIT.number(), User))
      .filter((q) => q.gt("age", 18))
      .unique("id")
      .groupBy("role")
      .select("id")
      .compile();
    const source = Compiler.emitQuerySource(JIT.map(JIT.number(), User).schema, {
      nodes: [
        { kind: "filter", condition: compare("gt", "age", "__q0") },
        { kind: "unique", key: "id" },
        { kind: "groupBy", key: "role" },
        { kind: "select:fields", fields: ["id"] },
      ],
      bindings: [18],
    });
    const result = query(inputMap);

    expect(result.admin).toEqual([{ id: 1 }]);
    expect(result.blocked).toEqual([{ id: 3 }]);
    expect(source).toContain("for (const entry of value)");
    expect(source).toContain("const item = entry[1];");
    expect(source).not.toContain("const [");
    expect(source).not.toContain("Array.from");
    expectNoInterpretedArrayOps(source);
    expectTypeOf(result).toEqualTypeOf<Record<string, { readonly id: number }[]>>();
  });

  it("should compile array delete and shallow update terminals", () => {
    const deleteBlocked = JIT.query(Users)
      .filter((q) => q.eq("role", "blocked"))
      .delete()
      .compile();
    const promoteAdults = JIT.query(Users)
      .filter((q) => q.gt("age", 18))
      .update({ role: "adult" })
      .compile();
    const deleteSource = Compiler.emitQuerySource(Users.schema, {
      nodes: [{ kind: "filter", condition: compare("eq", "role", "__q0") }, { kind: "delete" }],
      bindings: ["blocked"],
    });
    const updateSource = Compiler.emitQuerySource(Users.schema, {
      nodes: [
        { kind: "filter", condition: compare("gt", "age", "__q0") },
        { kind: "update", patch: { role: { kind: "binding", name: "__q1" } } },
      ],
      bindings: [18, "adult"],
    });
    const promoted = promoteAdults(input);

    expect(deleteBlocked(input)).toEqual([ada, grace, adaDuplicate]);
    expect(promoted).toEqual([
      { ...ada, role: "adult" },
      grace,
      { ...edsger, role: "adult" },
      { ...adaDuplicate, role: "adult" },
    ]);
    expect(promoted[1]).toBe(grace);
    expect(updateSource).toContain('"role": __q1');
    expect(updateSource).not.toContain("...");
    expect(deleteSource).not.toContain(".filter(");
    expectNoInterpretedArrayOps(updateSource);
  });

  it("should compile Set and Map delete/update terminals preserving collection kind", () => {
    const User = Users.schema.def.element;
    const deleteFromSet = JIT.query(JIT.set(User))
      .filter((q) => q.eq("role", "blocked"))
      .delete()
      .compile();
    const updateMap = JIT.query(JIT.map(JIT.number(), User))
      .filter((q) => q.eq("role", "admin"))
      .update({ name: "Admin" })
      .compile();
    const deletedSet = deleteFromSet(inputSet);
    const updatedMap = updateMap(inputMap);
    const source = Compiler.emitQuerySource(JIT.map(JIT.number(), User).schema, {
      nodes: [
        { kind: "filter", condition: compare("eq", "role", "__q0") },
        { kind: "update", patch: { name: { kind: "binding", name: "__q1" } } },
      ],
      bindings: ["admin", "Admin"],
    });

    expect(deletedSet).toBeInstanceOf(Set);
    expect([...deletedSet]).toEqual([ada, grace, adaDuplicate]);
    expect(updatedMap).toBeInstanceOf(Map);
    expect([...updatedMap.keys()]).toEqual([1, 2, 3]);
    expect(updatedMap.get(2)).toBe(grace);
    expect(updatedMap.get(1)).toEqual({ ...adaDuplicate, name: "Admin" });
    expect(source).toContain("out.set(entry[0]");
    expect(source).not.toContain("Array.from");
    expectNoInterpretedArrayOps(source);
  });

  it("should infer select output from rest fields without as const", () => {
    const oneField = JIT.query(Users).select("name").compile()(input);
    const twoFields = JIT.query(Users).select("id", "name").compile()(input);
    const chained = JIT.query(Users).select("id", "name").select("name").compile()(input);

    expectTypeOf(oneField).toEqualTypeOf<{ readonly name: string }[]>();
    expectTypeOf(twoFields).toEqualTypeOf<
      {
        readonly id: number;
        readonly name: string;
      }[]
    >();
    expectTypeOf(chained).toEqualTypeOf<{ readonly name: string }[]>();
  });

  it("should compile runtime params without captured bindings", () => {
    const adminsAboveAge = JIT.query(Users)
      .params({ minimumAge: JIT.number() })
      .filter((q, params) => q.and(q.gt("age", params.minimumAge), q.eq("role", JIT.const("admin"))))
      .select("id", "name")
      .compile();
    const source = Compiler.emitQuerySource(Users.schema, {
      nodes: [
        {
          kind: "filter",
          condition: {
            kind: "logical",
            op: "and",
            left: {
              kind: "compare",
              op: "gt",
              left: { kind: "field", key: "age" },
              right: { kind: "param", name: "minimumAge" },
            },
            right: {
              kind: "compare",
              op: "eq",
              left: { kind: "field", key: "role" },
              right: { kind: "literal", value: "admin" },
            },
          },
        },
        { kind: "select:fields", fields: ["id", "name"] },
      ],
      bindings: [],
      params: ["minimumAge"],
    });
    const result = adminsAboveAge(input, { minimumAge: 37 });

    expect(result).toEqual([{ id: 1, name: "Ada v2" }]);
    expect(source).toContain("function query(value, params)");
    expect(source).toContain("item.age > params.minimumAge");
    expect(source).toContain('item.role === "admin"');
    expect(source).not.toContain("__q0");
    expectNoInterpretedArrayOps(source);
    expectTypeOf(adminsAboveAge).toMatchTypeOf<
      (
        value: {
          id: number;
          name: string;
          age: number;
          role: string;
        }[],
        params: { readonly minimumAge: number }
      ) => { readonly id: number; readonly name: string }[]
    >();
  });

  it("should reject unknown keys and unsupported schemas", () => {
    expect(() =>
      JIT.query(Users)
        .filter((q) => q.gt("missing" as "age", 1))
        .compile()
    ).toThrow(Errors.JITError);
    expect(() => JIT.query(JIT.object({ id: JIT.number() })).compile()).toThrow(Errors.JITError);
    expect(() => JIT.query(Users).keyed("id").orderBy("age").compile()).toThrow(Errors.JITError);
    expect(() => JIT.query(Users).delete().compile()).toThrow(Errors.JITError);
    expect(() =>
      JIT.query(Users)
        .filter((q) => q.eq("role", "admin"))
        .select("name")
        .delete()
        .compile()
    ).toThrow(Errors.JITError);
    expect(() =>
      JIT.query(Users)
        .filter((q) => q.eq("role", "admin"))
        .update({ missing: "nope" } as unknown as { role: string })
        .compile()
    ).toThrow(Errors.JITError);

    // @ts-expect-error invalid query keys are rejected statically.
    JIT.query(Users).filter((q) => q.eq("missing", 1));
    JIT.query(Users)
      .select("name")
      // @ts-expect-error select only accepts fields still present in the output shape.
      .select("age");
    JIT.query(Users)
      .filter((q) => q.eq("role", "admin"))
      // @ts-expect-error update patch keys must exist on the query item.
      .update({ missing: "nope" });
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

function expectNoInterpretedArrayOps(source: string): void {
  expect(source).not.toContain(".filter(");
  expect(source).not.toContain(".map(");
  expect(source).not.toContain(".reduce(");
  expect(source).not.toContain(".some(");
  expect(source).not.toContain(".push(");
}

function countOccurrences(source: string, pattern: string): number {
  return source.split(pattern).length - 1;
}
