import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { JIT as DefineJIT } from "../../define.js";
import { AOT, JIT } from "../../index.js";
import { registerAotTestHooks, verifyGeneratedTypes } from "./aot-test-utils.js";

let outDir: string;
registerAotTestHooks((directory) => {
  outDir = directory;
});

it("should emit one self-contained and directly typed TypeScript module", async () => {
  const UserSchema = JIT.object({
    id: JIT.number().int32(),
    name: JIT.string(),
  });
  const User = {
    is: JIT.validate.is(UserSchema)!,
    parse: JIT.validate.parse(UserSchema)!,
  };
  const result = AOT.generate({
    groups: { User },
    schemas: { User: UserSchema },
    outDir,
    format: "ts",
  });
  const source = readFileSync(join(outDir, "index.ts"), "utf8");
  const generated = (await import(pathToFileURL(join(outDir, "index.ts")).href)) as {
    readonly User: {
      readonly is: (value: unknown) => boolean;
      readonly parse: (value: unknown) => { id: number; name: string };
    };
  };

  expect(result.files).toEqual([join(outDir, "index.ts")]);
  expect(existsSync(join(outDir, "index.js"))).toBe(false);
  expect(existsSync(join(outDir, "index.d.ts"))).toBe(false);
  expect(source).toContain("export type User = { id: number; name: string };");
  expect(source).toContain("const User: {");
  expect(source).not.toContain('from "@jit-compiler/jit"');
  expect(source).toMatchSnapshot("direct TypeScript AOT");
  expect(generated.User.is({ id: 1, name: "Ada" })).toBe(true);
  expect(generated.User.parse({ id: 1, name: "Ada" })).toEqual({
    id: 1,
    name: "Ada",
  });

  expect(() =>
    verifyGeneratedTypes(
      outDir,
      [
        'import { User, type User as UserValue } from "./index.js";',
        'const value: UserValue = { id: 1, name: "Ada" };',
        "User.parse(value);",
        "// @ts-expect-error name is required",
        "const invalid: UserValue = { id: 2 };",
        "void invalid;",
        "",
      ].join("\n")
    )
  ).not.toThrow();
}, 30_000);

it("should emit one ready-to-run JavaScript module without declaration artifacts", () => {
  const User = JIT.object({
    id: JIT.number().int32(),
    name: JIT.string().min(2),
  });
  const isUser = JIT.validate.is(User);
  const result = AOT.generate({
    groups: {},
    artifacts: { isUser },
    outDir,
    format: "js",
  });

  expect(result.files).toEqual([join(outDir, "index.js")]);
  expect(existsSync(join(outDir, "index.js"))).toBe(true);
  expect(existsSync(join(outDir, "index.d.ts"))).toBe(false);
});

it("should reject removed output formats at the programmatic boundary", () => {
  expect(() =>
    AOT.generate({
      groups: {},
      artifacts: { isValue: JIT.validate.is(JIT.string()) },
      outDir,
      format: "typescript" as never,
    })
  ).toThrow(/expected "ts" or "js"/);
});

it("should emit standalone functions against named structural schema types", () => {
  const User = JIT.object({
    id: JIT.number().int32(),
    name: JIT.string().min(2),
    role: JIT.union(JIT.literal("admin"), JIT.literal("member")),
  });
  const isUser = JIT.validate.is(User);

  AOT.generate({
    groups: {},
    schemas: { User },
    artifacts: { isUser },
    outDir,
    format: "ts",
  });
  const source = readFileSync(join(outDir, "index.ts"), "utf8");

  expect(source).toContain('export type User = { id: number; name: string; role: "admin" | "member" };');
  expect(source).toContain("const isUser: (value: unknown) => value is User =");
  expect(source).not.toContain('import("@jit-compiler/jit")');
});

it("should emit DTO-annotated schemas through validation, JSON, and map artifacts", async () => {
  const User = JIT.object({
    id: JIT.number().int32(),
    fullName: JIT.string(),
    passwordHash: JIT.string(),
  });
  const Public = JIT.dto(JIT.object({ id: JIT.number().int32(), name: JIT.string() }));
  const result = AOT.generate({
    groups: {},
    artifacts: {
      Public_is: JIT.validate.is(Public),
      Public_stringify: JIT.json.stringify(Public),
      Public_from: JIT.map(User, Public, { name: { from: "fullName" } }),
      Public_many: JIT.map.many(User, Public, { name: { from: "fullName" } }),
    },
    outDir,
  });
  const source = readFileSync(join(outDir, "index.js"), "utf8");
  const generated = (await import(pathToFileURL(join(outDir, "index.js")).href)) as {
    readonly Public_is: (value: unknown) => boolean;
    readonly Public_stringify: (value: unknown) => string;
    readonly Public_from: (value: { id: number; fullName: string; passwordHash: string }) => {
      id: number;
      name: string;
    };
    readonly Public_many: (
      value: readonly {
        id: number;
        fullName: string;
        passwordHash: string;
      }[]
    ) => {
      id: number;
      name: string;
    }[];
  };
  const entity = { id: 1, fullName: "Ada", passwordHash: "secret" };

  expect(result.skipped).toHaveLength(0);
  expect(generated.Public_is({ id: 1, name: "Ada" })).toBe(true);
  expect(generated.Public_from(entity)).toEqual({ id: 1, name: "Ada" });
  expect(generated.Public_many([entity])).toEqual([{ id: 1, name: "Ada" }]);
  expect(generated.Public_stringify({ id: 1, name: "Ada" })).toBe('{"id":1,"name":"Ada"}');
  expect(source).not.toContain("passwordHash");
  expect(source).not.toContain('from "@jit-compiler/jit"');
});

it("should lower JSON, validation, query, and JSON output from one execution descriptor", async () => {
  const User = JIT.object({
    id: JIT.number().int32(),
    name: JIT.string().min(2),
    active: JIT.boolean(),
  });
  const Users = JIT.array(User);
  const activeUsers = JIT.json
    .parse(Users)
    .validate()
    .filter((query) => query.eq("active", true))
    .select("id", "name")
    .to.json();
  const result = AOT.generate({
    groups: {},
    artifacts: { activeUsers },
    outDir,
  });
  const source = readFileSync(join(outDir, "index.js"), "utf8");
  const generated = (await import(pathToFileURL(join(outDir, "index.js")).href)) as {
    readonly activeUsers: (json: string) => string;
  };

  expect(result.skipped).toHaveLength(0);
  expect(generated.activeUsers('[{"id":1,"name":"Ada","active":true},{"id":2,"name":"Grace","active":false}]')).toBe(
    '[{"id":1,"name":"Ada"}]'
  );
  expect(source).toContain("function query(value)");
  expect(source).not.toContain('from "@jit-compiler/jit"');
});

it("should lower runtime value objects as import-free classes", async () => {
  const Money = JIT.ddd.valueObject(
    JIT.object({
      amount: JIT.number(),
      currency: JIT.enum(["BRL", "USD"]),
    }).hash("ordered")
  );
  const result = AOT.generate({ groups: {}, artifacts: { Money }, outDir });
  const source = readFileSync(join(outDir, "index.js"), "utf8");
  const generated = (await import(pathToFileURL(join(outDir, "index.js")).href)) as {
    readonly Money: {
      create(input: { amount: number; currency: "BRL" | "USD" }): {
        readonly value: { amount: number; currency: "BRL" | "USD" };
        equals(other: unknown): boolean;
        hashCode(): number;
      };
    };
  };

  const money = generated.Money.create({ amount: 10, currency: "BRL" });

  expect(result.skipped).toHaveLength(0);
  expect(source).toContain("return class Money");
  expect(source).toContain("const __hash = Money_equal_hash");
  expect(source).not.toContain("Money_equal(this, other)");
  expect(source).not.toContain('from "@jit-compiler/jit"');
  expect(Object.isFrozen(money)).toBe(true);
  expect(money.value).toBe(money);
  expect(
    () =>
      new (generated.Money as unknown as new (input: unknown) => unknown)({
        amount: 10,
        currency: "BRL",
      })
  ).toThrow(/factory construction/i);
  expect(money.equals(generated.Money.create({ amount: 10, currency: "BRL" }))).toBe(true);
  expect(money.hashCode()).toBe(generated.Money.create({ amount: 10, currency: "BRL" }).hashCode());
});

it("snapshots reconstructive plain, DDD and lifecycle class layouts", () => {
  const Plain = JIT.class(JIT.object({ id: JIT.string(), name: JIT.string(), age: JIT.number() }));
  const User = JIT.ddd.entity(JIT.object({ id: JIT.string(), name: JIT.string() }), { id: "id" });
  const UserId = JIT.ddd.uniqueIdentifier(JIT.string().uuid());
  const Order = JIT.ddd
    .aggregateRoot(JIT.object({ id: UserId, status: JIT.string() }))
    .extends(JIT.ddd.timestamps(), JIT.ddd.softDelete(), JIT.ddd.versioned());

  const result = AOT.generate({
    artifacts: { Plain, User, UserId, Order },
    outDir,
  });
  const source = readFileSync(join(outDir, "index.js"), "utf8");

  expect(result.skipped).toHaveLength(0);
  expect(source).toMatchSnapshot("reconstructive runtime class layouts");
  expect(source).not.toContain('Object.defineProperty(this, "name"');
  expect(source).toContain('get ["name"]()');
  expect(source).toContain("get _props()");
  expect(source).toContain("this[User_state] = state;");
  expect(source).toContain("const User_state = Symbol();");
  expect(source).not.toContain("Proxy");
  expect(source).not.toContain("Reflect");
  expect(source).not.toContain("sameIdentity");
  expect(source).not.toContain("update(patch)");
});

it("lowers the class JSON capability through the serializer compiler", async () => {
  const User = JIT.ddd
    .entity(
      JIT.object({
        id: JIT.string(),
        name: JIT.string(),
        tags: JIT.array(JIT.string()),
      }),
      { id: "id" }
    )
    .extends(
      {
        secret: JIT.class.private(JIT.string()),
        cache: JIT.class.noConstructor(JIT.array(JIT.string()).default(() => [])),
      },
      JIT.class.json({ method: "serialize" })
    );
  const result = AOT.generate({ artifacts: { User }, outDir });
  const source = readFileSync(join(outDir, "index.js"), "utf8");
  const generated = (await import(pathToFileURL(join(outDir, "index.js")).href)) as {
    readonly User: typeof User;
  };

  expect(result.skipped).toEqual([]);
  expect(source).toContain("serialize() { return User_json(this); }");
  expect(source).not.toContain("JSON.stringify(this)");
  const user = generated.User.create({
    id: "u_1",
    name: "Ada",
    tags: ["admin"],
    secret: "hidden",
  });
  expect(user.serialize()).toBe('{"id":"u_1","name":"Ada","tags":["admin"],"secret":"hidden"}');
  expect(user.serialize()).not.toContain("cache");
});

it("reconstructs nested assertion guards without a runtime callback binding", async () => {
  const Money = JIT.ddd.valueObject(JIT.object({ amount: JIT.number() })).assert((query) => query.gte("amount", 0));
  const Order = JIT.ddd.entity(JIT.object({ id: JIT.string(), total: Money }), {
    id: "id",
  });
  const result = AOT.generate({
    groups: {},
    artifacts: { Money, Order },
    outDir,
  });
  const source = readFileSync(join(outDir, "index.js"), "utf8");
  const generated = (await import(pathToFileURL(join(outDir, "index.js")).href)) as {
    readonly Order: typeof Order;
  };

  expect(result.skipped).toHaveLength(0);
  expect(source).toContain("Money_assertion");
  try {
    generated.Order.create({ id: "o_1", total: { amount: -1 } });
    throw new Error("expected nested assertion failure");
  } catch (error) {
    expect(error).toMatchObject({
      name: "JITValidationError",
      code: "VALIDATION_FAILED",
    });
    expect(
      (
        error as {
          readonly issues: readonly { readonly path: readonly unknown[] }[];
        }
      ).issues[0]?.path
    ).toEqual(["total", "amount"]);
  }
  expect(generated.Order.create({ id: "o_2", total: { amount: 1 } }).total.amount).toBe(1);
});

it("should reject application methods because function source is not an AOT artifact", () => {
  const Schema = JIT.object({ id: JIT.string(), name: JIT.string() });
  const User = JIT.class(Schema)
    .extends(JIT.class.equals)
    .extends({
      displayName() {
        return this.name.toUpperCase();
      },
      sameAs(other: unknown) {
        return this.equals(other);
      },
      get initial() {
        return this.name[0];
      },
    });
  const result = AOT.generate({ groups: {}, artifacts: { User }, outDir });
  expect(result.skipped).toEqual([
    {
      schema: "User",
      operation: "class.extends",
      reason: expect.stringContaining('"displayName"'),
    },
  ]);
});

it("should preserve a diagnostic issue limit in standalone AOT", async () => {
  const Schema = JIT.object({
    first: JIT.string(),
    second: JIT.string(),
    third: JIT.string(),
  });
  const Limited = JIT.validate.safeParse(Schema, { maxIssues: 2 });
  const result = AOT.generate({ groups: {}, artifacts: { Limited }, outDir });
  const source = readFileSync(join(outDir, "index.js"), "utf8");
  const generated = (await import(pathToFileURL(join(outDir, "index.js")).href)) as {
    readonly Limited: typeof Limited;
  };
  const runtime = Limited({ first: 1, second: 2, third: 3 });
  const aot = generated.Limited({ first: 1, second: 2, third: 3 });

  expect(result.skipped).toEqual([]);
  expect(aot).toEqual(runtime);
  expect(aot.success === false && aot.issues).toHaveLength(2);
  expect(source).toContain("throw __issueLimit");
  expect(source).not.toContain(".slice(");
});

it("should preserve a define-host diagnostic issue limit in standalone AOT", async () => {
  const Schema = DefineJIT.object({
    first: DefineJIT.string(),
    second: DefineJIT.string(),
  });
  const Limited = DefineJIT.validate.safeParse(Schema, { maxIssues: 1 });
  const result = AOT.generate({ groups: {}, artifacts: { Limited }, outDir });
  const generated = (await import(pathToFileURL(join(outDir, "index.js")).href)) as {
    readonly Limited: (value: unknown) => {
      readonly success: boolean;
      readonly issues?: readonly unknown[];
    };
  };
  const parsed = generated.Limited({ first: 1, second: 2 });

  expect(result.skipped).toEqual([]);
  expect(parsed.success).toBe(false);
  expect(parsed.issues).toHaveLength(1);
});

it("should preserve a factory diagnostic issue limit in standalone AOT", async () => {
  const Schema = JIT.object({
    first: JIT.string(),
    second: JIT.string(),
    third: JIT.string(),
  });
  const Limited = JIT.ddd.valueObject(Schema).validate({ result: "either", maxIssues: 2 });
  const result = AOT.generate({ groups: {}, artifacts: { Limited }, outDir });
  const generated = (await import(pathToFileURL(join(outDir, "index.js")).href)) as {
    readonly Limited: typeof Limited;
  };
  const input = { first: 1, second: 2, third: 3 } as never;
  const runtime = Limited.create(input);
  const aot = generated.Limited.create(input);

  expect(result.skipped).toEqual([]);
  expect(JIT.class.isFailure(aot)).toBe(true);
  expect(JIT.class.isFailure(runtime)).toBe(true);
  if (!JIT.class.isFailure(aot) || !JIT.class.isFailure(runtime))
    throw new Error("expected both factories to reject the input");
  expect(aot.error.issues).toEqual(runtime.error.issues);
  expect(aot.error.issues).toHaveLength(2);
});

it("should preserve null tuple factory channels in standalone AOT", async () => {
  const Tuple = JIT.ddd.valueObject(JIT.object({ name: JIT.string() })).validate({ result: "tuple" });
  const result = AOT.generate({ groups: {}, artifacts: { Tuple }, outDir });
  const generated = (await import(pathToFileURL(join(outDir, "index.js")).href)) as {
    readonly Tuple: typeof Tuple;
  };

  expect(result.skipped).toEqual([]);
  expect(generated.Tuple.create({ name: "Ada" })[0]).toBeNull();
  expect(generated.Tuple.create({ name: 1 } as never)[1]).toBeNull();
});

it("should preserve explicit construction modes in standalone AOT", async () => {
  const Factory = JIT.class(JIT.object({ value: JIT.string() })).construction("factory");
  const Constructor = JIT.ddd.valueObject(JIT.string()).construction("constructor");
  const result = AOT.generate({
    groups: {},
    artifacts: { Factory, Constructor },
    outDir,
  });
  const generated = (await import(pathToFileURL(join(outDir, "index.js")).href)) as {
    readonly Factory: typeof Factory;
    readonly Constructor: typeof Constructor;
  };

  expect(result.skipped).toEqual([]);
  expect(generated.Factory.create({ value: "factory" }).value).toBe("factory");
  expect(new generated.Constructor("direct").value).toBe("direct");
  expect("create" in generated.Constructor).toBe(false);
});

it("should preserve an assertion issue limit in standalone AOT", async () => {
  const Limited = JIT.ddd
    .valueObject(JIT.object({ a: JIT.number(), b: JIT.number(), c: JIT.number() }))
    .assert((query) => query.gte("a", 0))
    .assert((query) => query.gte("b", 0))
    .assert((query) => query.gte("c", 0))
    .validate({ result: "either", maxIssues: 2 });
  const result = AOT.generate({ groups: {}, artifacts: { Limited }, outDir });
  const generated = (await import(pathToFileURL(join(outDir, "index.js")).href)) as {
    readonly Limited: typeof Limited;
  };
  const runtime = Limited.create({ a: -1, b: -1, c: -1 });
  const aot = generated.Limited.create({ a: -1, b: -1, c: -1 });

  expect(result.skipped).toEqual([]);
  expect(JIT.class.isFailure(runtime)).toBe(true);
  expect(JIT.class.isFailure(aot)).toBe(true);
  if (!JIT.class.isFailure(runtime) || !JIT.class.isFailure(aot))
    throw new Error("expected both factories to reject the assertions");
  expect(aot.error.issues).toEqual(runtime.error.issues);
  expect(aot.error.issues).toHaveLength(2);
});

it("should skip a class whose extension reaches outside its own body", () => {
  const outside = { suffix: "!" };
  const Loud = JIT.class(JIT.object({ name: JIT.string() })).extends({
    shout() {
      return this.name + outside.suffix;
    },
  });
  const result = AOT.generate({ groups: {}, artifacts: { Loud }, outDir });

  // Never silently dropped: the build says which member it could not carry.
  expect(result.skipped).toEqual([
    {
      schema: "Loud",
      operation: "class.extends",
      reason: expect.stringContaining('"shout"'),
    },
  ]);
});

it("should skip a class whose DDD clock is a runtime binding", () => {
  const Order = JIT.ddd
    .aggregateRoot(JIT.object({ id: JIT.string(), updatedAt: JIT.date() }), {
      id: "id",
    })
    .extends(JIT.ddd.timestamps({ updatedAt: "updatedAt", clock: () => new Date(0) }));
  const result = AOT.generate({ groups: {}, artifacts: { Order }, outDir });

  expect(result.skipped).toEqual([
    {
      schema: "Order",
      operation: "class.extends",
      reason: expect.stringContaining("custom DDD clock"),
    },
  ]);
});
