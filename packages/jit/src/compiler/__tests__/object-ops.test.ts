import { Compiler, Errors, JIT } from "../../index.js";

describe("JIT compiler object operations", () => {
  const User = JIT.object({
    id: JIT.number(),
    name: JIT.string(),
    role: JIT.string(),
    profile: JIT.object({
      score: JIT.number(),
      city: JIT.string(),
    }),
  });

  it("should compile structural-sharing merge functions", () => {
    const merge = Compiler.compileMerge(User.schema);
    const input = {
      id: 1,
      name: "Ada",
      role: "admin",
      profile: { score: 10, city: "London" },
    };
    const source = Compiler.emitMergeSource(User.schema);

    expect(merge(input, {})).toBe(input);
    expect(merge(input, { name: "Ada", profile: { score: 10 } })).toBe(input);

    const output = merge(input, { profile: { score: 11 } });

    expect(output).toEqual({
      id: 1,
      name: "Ada",
      role: "admin",
      profile: { score: 11, city: "London" },
    });
    expect(output).not.toBe(input);
    expect(output.profile).not.toBe(input.profile);
    expect(source).toContain("right.name !== undefined ? right.name : left.name");
    expect(source).not.toContain("Object.keys");
    expect(source).not.toContain(".push(");
    expectTypeOf(merge).parameter(1).toEqualTypeOf<{
      readonly id?: number | undefined;
      readonly name?: string | undefined;
      readonly role?: string | undefined;
      readonly profile?: {
        readonly score?: number | undefined;
        readonly city?: string | undefined;
      };
    }>();
  });

  it("should compile inline pick and omit functions", () => {
    const input = {
      id: 1,
      name: "Ada",
      role: "admin",
      profile: { score: 10, city: "London" },
    };
    const pick = Compiler.compilePick(User.schema, ["id", "name"]);
    const omit = Compiler.compileOmit(User.schema, ["profile"]);
    const pickSource = Compiler.emitPickSource(User.schema, ["id", "name"]);
    const omitSource = Compiler.emitOmitSource(User.schema, ["profile"]);

    expect(pick(input)).toEqual({ id: 1, name: "Ada" });
    expect(omit(input)).toEqual({ id: 1, name: "Ada", role: "admin" });
    expect(pickSource).toContain('return { "id": value.id, "name": value.name };');
    expect(omitSource).toContain('return { "id": value.id, "name": value.name, "role": value.role };');
    expect(pickSource).not.toContain("for (");
    expect(omitSource).not.toContain("Object.keys");
    expectTypeOf(pick(input)).toEqualTypeOf<{ readonly id: number; readonly name: string }>();
    expectTypeOf(omit(input)).toEqualTypeOf<{
      readonly id: number;
      readonly name: string;
      readonly role: string;
    }>();
  });

  it("should compile transforms with external bindings", () => {
    const transform = Compiler.compileTransform(User.schema, {
      name: (value) => value.toUpperCase(),
      role: (value, source) => `${source.id}:${value}`,
    });
    const source = Compiler.emitTransformSource(User.schema, {
      name: (value) => value.toUpperCase(),
    });
    const output = transform({
      id: 1,
      name: "Ada",
      role: "admin",
      profile: { score: 10, city: "London" },
    });

    expect(output).toEqual({
      id: 1,
      name: "ADA",
      role: "1:admin",
      profile: { score: 10, city: "London" },
    });
    expect(source).toContain("__t0(value.name, value)");
    expect(source).not.toContain("toUpperCase");
    expectTypeOf(output).toEqualTypeOf<{
      readonly id: number;
      readonly name: string;
      readonly role: string;
      readonly profile: {
        readonly score: number;
        readonly city: string;
      };
    }>();
  });

  it("should compile normalize functions from keyed arrays", () => {
    const Users = JIT.array(User).keyed("id");
    const normalize = Compiler.compileNormalize(Users.schema);
    const source = Compiler.emitNormalizeSource(Users.schema);
    const first = {
      id: 1,
      name: "Ada",
      role: "admin",
      profile: { score: 10, city: "London" },
    };
    const second = {
      id: 2,
      name: "Grace",
      role: "user",
      profile: { score: 20, city: "New York" },
    };

    expect(normalize([first, second])).toEqual({
      byId: { 1: first, 2: second },
      ids: [1, 2],
    });
    expect(source).toContain("const ids = new Array(len);");
    expect(source).toContain("const id = item.id;");
    expect(source).not.toContain("Object.keys");
    expect(source).not.toContain(".map(");
    expectTypeOf(normalize([first, second]).ids).toEqualTypeOf<(string | number)[]>();
  });

  it("should compile groupBy functions for object arrays", () => {
    const Users = JIT.array(User).groupBy("role");
    const groupBy = Compiler.compileGroupBy(Users.schema);
    const source = Compiler.emitGroupBySource(Users.schema);
    const admin = {
      id: 1,
      name: "Ada",
      role: "admin",
      profile: { score: 10, city: "London" },
    };
    const user = {
      id: 2,
      name: "Grace",
      role: "user",
      profile: { score: 20, city: "New York" },
    };

    expect(groupBy([admin, user, { ...admin, id: 3 }])).toEqual({
      admin: [admin, { ...admin, id: 3 }],
      user: [user],
    });
    expect(source).toContain("const key = item.role;");
    expect(source).toContain("group[group.length] = item;");
    expect(source).not.toContain(".push(");
    expectTypeOf(groupBy([admin, user])).toMatchTypeOf<Record<string, (typeof admin)[]>>();
  });

  it("should compile sortBy functions with ordered hints", () => {
    const Users = JIT.array(User).sortBy("id", "desc");
    const sortBy = Compiler.compileSortBy(Users.schema);
    const source = Compiler.emitSortBySource(Users.schema);
    const first = {
      id: 1,
      name: "Ada",
      role: "admin",
      profile: { score: 10, city: "London" },
    };
    const second = {
      id: 2,
      name: "Grace",
      role: "user",
      profile: { score: 20, city: "New York" },
    };
    const input = [first, second];

    expect(sortBy(input)).toEqual([second, first]);
    expect(sortBy(input)).not.toBe(input);
    expect(source).toContain("const out = value.slice();");
    expect(source).toContain("const leftValue = left.id;");
    expect(source).toContain("return leftValue < rightValue ? 1 : -1;");
    expectTypeOf(sortBy(input)).toMatchTypeOf<typeof input>();
  });

  it("should compile uniqueBy functions from keyed arrays", () => {
    const Users = JIT.array(User).uniqueBy("id");
    const uniqueBy = Compiler.compileUniqueBy(Users.schema);
    const source = Compiler.emitUniqueBySource(Users.schema);
    const first = {
      id: 1,
      name: "Ada",
      role: "admin",
      profile: { score: 10, city: "London" },
    };
    const duplicate = {
      id: 1,
      name: "Ada v2",
      role: "admin",
      profile: { score: 11, city: "Paris" },
    };
    const second = {
      id: 2,
      name: "Grace",
      role: "user",
      profile: { score: 20, city: "New York" },
    };

    expect(uniqueBy([first, duplicate, second])).toEqual([first, second]);
    expect(source).toContain("const seen = new Set();");
    expect(source).toContain("const key = item.id;");
    expect(source).toContain("out[out.length] = item;");
    expect(source).not.toContain(".push(");
    expectTypeOf(uniqueBy([first, duplicate, second])).toMatchTypeOf<(typeof first)[]>();
  });

  it("should throw JITError with INVALID_OPERATION on schema misuse", () => {
    const User = JIT.object({ id: JIT.number(), name: JIT.string() });

    const cases = [
      () => Compiler.compileNormalize(User.schema),
      () => Compiler.compileGroupBy(JIT.array(User).schema),
      () => Compiler.compilePick(JIT.array(User).schema as never, ["id"] as never),
      () => Compiler.compilePick(User.schema, ["missing"] as unknown as ["id"]),
    ];

    for (const compile of cases) {
      try {
        compile();
        expect.unreachable();
      } catch (error) {
        expect(error).toBeInstanceOf(Errors.JITError);
        expect((error as Errors.JITError).code).toBe("INVALID_OPERATION");
      }
    }
  });
});
