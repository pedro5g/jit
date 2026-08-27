import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { AOT, JIT } from "../../index.js";

describe("JIT AOT generate", () => {
  let outDir: string;

  beforeEach(() => {
    outDir = mkdtempSync(join(tmpdir(), "jit-aot-"));
  });

  afterEach(() => {
    rmSync(outDir, { recursive: true, force: true });
  });

  it("should emit only explicitly grouped operations", async () => {
    const User = JIT.object({ id: JIT.number().int32(), name: JIT.string() });
    const UserRuntime = { is: JIT.validate.is(User), clone: JIT.clone(User) };
    const result = AOT.generate({ groups: { User: UserRuntime }, outDir });
    const source = readFileSync(join(outDir, "index.js"), "utf8");
    const generated = (await import(pathToFileURL(join(outDir, "index.js")).href)) as {
      readonly User: {
        readonly is: (value: unknown) => boolean;
        readonly clone: <T>(value: T) => T;
      };
    };

    expect(result.skipped).toHaveLength(0);
    expect(Object.keys(generated.User)).toEqual(["is", "clone"]);
    expect(generated.User.is({ id: 1, name: "Ada" })).toBe(true);
    expect(generated.User.clone({ id: 1, name: "Ada" })).toEqual({
      id: 1,
      name: "Ada",
    });
    expect(source).toContain("function is(value)");
    expect(source).toContain("function clone(value)");
    expect(source).not.toContain("function safeParse(value)");
    expect(source).not.toContain("function stringify");
    expect(result.files).toEqual([join(outDir, "index.js")]);
  });

  it("emits fromJSON as native parsing followed by specialized validation", async () => {
    const User = JIT.object({
      id: JIT.number().int32(),
      name: JIT.string().min(2),
    });
    const Json = { fromJSON: JIT.json.parse(User).validate() };

    AOT.generate({ groups: { Json }, outDir });
    const source = readFileSync(join(outDir, "index.js"), "utf8");

    expect(source).toContain("JSON.parse");
    expect(source).toContain("safeParse");
    expect(source).not.toContain("const Json_parse");

    const generated = (await import(pathToFileURL(join(outDir, "index.js")).href)) as {
      Json: { fromJSON: (json: string) => { id: number; name: string } };
    };

    expect(generated.Json.fromJSON('{"id":1,"name":"Ada"}')).toEqual({
      id: 1,
      name: "Ada",
    });
  });

  it("emits dynamic CQRS input as an import-free parser artifact", async () => {
    const User = JIT.object({ id: JIT.string(), age: JIT.number() });
    const ListUsers = JIT.cqrs.input(User, {
      filter: { id: true, age: ["gte"] },
      sort: ["id", "age"],
      select: true,
      pagination: { type: "offset", defaultLimit: 20, maxLimit: 100 },
    });

    const result = AOT.generate({ artifacts: { ListUsers }, outDir });
    const source = readFileSync(join(outDir, "index.js"), "utf8");
    const generated = (await import(pathToFileURL(join(outDir, "index.js")).href)) as {
      readonly ListUsers: {
        readonly parse: (input: unknown) => unknown;
        readonly "~query": { readonly version: number };
      };
    };

    expect(result.skipped).toHaveLength(0);
    expect(source).not.toContain('from "@jit-compiler/jit"');
    expect(source).not.toContain("__reference");
    expect(generated.ListUsers["~query"].version).toBe(1);
    expect(generated.ListUsers.parse({ filter: { age: { $gte: 18 } } })).toEqual({
      filter: [{ kind: "gte", path: ["age"], value: 18 }],
      sort: [],
      pagination: { kind: "offset", offset: 0, limit: 20 },
    });
    expect(() => generated.ListUsers.parse([])).toThrow(/invalid CQRS input/i);
    expect(() => generated.ListUsers.parse({ filter: { id: { $eq: "u_1" } } })).toThrow(/invalid CQRS input/i);
    expect(() => generated.ListUsers.parse({ sort: "age,age" })).toThrow(/invalid CQRS input/i);
    expect(() => generated.ListUsers.parse({ fields: "id,id" })).toThrow(/invalid CQRS input/i);
    expect(() => generated.ListUsers.parse({ fields: "" })).toThrow(/invalid CQRS input/i);
    expect(() => generated.ListUsers.parse({ sort: 42 })).toThrow(/invalid CQRS input/i);
    expect(() => generated.ListUsers.parse({ unknown: true })).toThrow(/invalid CQRS input/i);
    expect(() => generated.ListUsers.parse({ page: Number.MAX_SAFE_INTEGER, limit: 100 })).toThrow(
      /invalid CQRS input/i
    );
  });

  it("preserves the structural query protocol on an AOT static CQRS query", async () => {
    const User = JIT.object({
      id: JIT.string(),
      age: JIT.number(),
      active: JIT.boolean(),
    });
    const ActiveUsers = JIT.cqrs
      .query(User)
      .params({ minimumAge: JIT.number() })
      .where((query, params) => query.gte("age", params.minimumAge))
      .where((query) => query.eq("active", true))
      .select("id", "age")
      .limit(1);
    AOT.generate({ artifacts: { ActiveUsers }, outDir });
    const generated = (await import(pathToFileURL(join(outDir, "index.js")).href)) as {
      readonly ActiveUsers: ((
        rows: { id: string; age: number; active: boolean }[],
        params: { minimumAge: number }
      ) => unknown) & {
        readonly "~query": {
          readonly version: number;
          readonly definition: {
            readonly filter?: {
              readonly kind: string;
              readonly operator?: string;
            };
            readonly params?: readonly string[];
            readonly projection?: readonly string[];
            readonly limit?: number;
          };
        };
      };
    };

    expect(generated.ActiveUsers["~query"]).toMatchObject({
      version: 1,
      definition: {
        filter: { kind: "logical", operator: "and" },
        params: ["minimumAge"],
        projection: ["id", "age"],
        limit: 1,
      },
    });
    expect(
      generated.ActiveUsers(
        [
          { id: "u_1", age: 30, active: true },
          { id: "u_4", age: 50, active: true },
          { id: "u_2", age: 17, active: true },
          { id: "u_3", age: 40, active: false },
        ],
        { minimumAge: 18 }
      )
    ).toEqual([{ id: "u_1", age: 30 }]);
  });

  it("inlines compound cursor decoding for AOT CQRS input", async () => {
    const User = JIT.object({ id: JIT.string(), createdAt: JIT.string() });
    const ListUsers = JIT.cqrs.input(User, {
      pagination: {
        type: "cursor",
        by: ["createdAt", "id"],
        defaultLimit: 20,
        maxLimit: 100,
      },
    });
    AOT.generate({ artifacts: { ListUsers }, outDir });
    const source = readFileSync(join(outDir, "index.js"), "utf8");
    const generated = (await import(pathToFileURL(join(outDir, "index.js")).href)) as {
      readonly ListUsers: { readonly parse: (input: unknown) => unknown };
    };

    expect(source).toContain("function decodeCursor(value, size)");
    expect(
      generated.ListUsers.parse({
        after: btoa('["2026-01-01","u_1"]'),
        limit: 10,
      })
    ).toEqual({
      filter: [],
      sort: [
        { path: ["createdAt"], direction: "asc" },
        { path: ["id"], direction: "asc" },
      ],
      pagination: { kind: "cursor", after: ["2026-01-01", "u_1"], limit: 10 },
    });
  });

  it("should emit one self-contained and directly typed TypeScript module", async () => {
    const UserSchema = JIT.object({
      id: JIT.number().int32(),
      name: JIT.string(),
    });
    const User = {
      is: JIT.validate.is(UserSchema),
      parse: JIT.validate.parse(UserSchema),
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

    writeFileSync(
      join(outDir, "consumer.ts"),
      [
        'import { User, type User as UserValue } from "./index.js";',
        'const value: UserValue = { id: 1, name: "Ada" };',
        "User.parse(value);",
        "// @ts-expect-error name is required",
        "const invalid: UserValue = { id: 2 };",
        "void invalid;",
        "",
      ].join("\n")
    );
    writeFileSync(
      join(outDir, "tsconfig.json"),
      JSON.stringify({
        compilerOptions: {
          exactOptionalPropertyTypes: true,
          module: "NodeNext",
          moduleResolution: "NodeNext",
          noEmit: true,
          strict: true,
          target: "ES2022",
        },
        include: ["index.ts", "consumer.ts"],
      })
    );
    writeFileSync(join(outDir, "package.json"), '{"type":"module"}\n');

    expect(() =>
      execFileSync(process.execPath, [join(process.cwd(), "node_modules", "typescript", "bin", "tsc")], {
        cwd: outDir,
        stdio: "pipe",
      })
    ).not.toThrow();
  });

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
        currency: JIT.enum(["BRL", "USD"] as const),
      }).hash("ordered")
    );
    const result = AOT.generate({ groups: {}, artifacts: { Money }, outDir });
    const source = readFileSync(join(outDir, "index.js"), "utf8");
    const generated = (await import(pathToFileURL(join(outDir, "index.js")).href)) as {
      readonly Money: {
        new (input: {
          amount: number;
          currency: "BRL" | "USD";
        }): {
          equals(other: unknown): boolean;
          hashCode(): number;
        };
        create(input: { amount: number; currency: "BRL" | "USD" }): {
          equals(other: unknown): boolean;
          hashCode(): number;
        };
      };
    };

    const money = generated.Money.create({ amount: 10, currency: "BRL" });
    const constructed = new generated.Money({ amount: 10, currency: "BRL" });

    expect(result.skipped).toHaveLength(0);
    expect(source).toContain("return class Money");
    expect(source).toContain("const __hash = Money_equal_hash");
    expect(source).not.toContain("Money_equal(this, other)");
    expect(source).not.toContain('from "@jit-compiler/jit"');
    expect(Object.isFrozen(money)).toBe(true);
    expect(constructed.equals(money)).toBe(true);
    expect(money.equals(generated.Money.create({ amount: 10, currency: "BRL" }))).toBe(true);
    expect(money.hashCode()).toBe(generated.Money.create({ amount: 10, currency: "BRL" }).hashCode());
  });

  it("should preserve abstract value-object behavior in AOT subclasses", async () => {
    const MoneyBase = JIT.ddd.valueObject.abstract(
      JIT.object({
        amount: JIT.number(),
        currency: JIT.enum(["BRL", "USD"] as const),
      })
    );
    const result = AOT.generate({ artifacts: { MoneyBase }, outDir });
    const generated = (await import(pathToFileURL(join(outDir, "index.js")).href)) as {
      readonly MoneyBase: {
        new (
          input: unknown
        ): {
          equals(other: unknown): boolean;
          hashCode(): number;
        };
        create(input: unknown): unknown;
        hydrate(input: unknown): unknown;
      };
    };
    class Money extends generated.MoneyBase {}

    const money = Money.create({ amount: 10, currency: "BRL" }) as InstanceType<typeof Money>;
    const restored = Money.hydrate({
      amount: 10,
      currency: "BRL",
    }) as InstanceType<typeof Money>;

    expect(result.skipped).toEqual([]);
    expect(money).toBeInstanceOf(Money);
    expect(Object.isFrozen(money)).toBe(true);
    expect(money.equals(restored)).toBe(true);
    expect(money.hashCode()).toBe(restored.hashCode());
    expect(() => generated.MoneyBase.create({ amount: 10, currency: "BRL" })).toThrow(/abstract JIT class/i);
  });

  it("should keep creation defaults out of AOT hydration", async () => {
    const User = JIT.class(JIT.object({ id: JIT.string().default("generated"), name: JIT.string() }));
    const result = AOT.generate({ groups: {}, artifacts: { User }, outDir });
    const generated = (await import(pathToFileURL(join(outDir, "index.js")).href)) as {
      readonly User: {
        create(input: { name: string }): { id: string; name: string };
        hydrate(state: { id: string; name: string }): {
          id: string;
          name: string;
        };
      };
    };

    expect(result.skipped).toHaveLength(0);
    expect(generated.User.create({ name: "Ada" })).toEqual({
      id: "generated",
      name: "Ada",
    });
    expect(() => generated.User.hydrate({ name: "Ada" } as never)).toThrow();
  });

  it("should preserve configured class factories in runtime and typed AOT output", async () => {
    const User = JIT.class(JIT.object({ id: JIT.string(), name: JIT.string() })).factories({
      create: "make",
      hydrate: "restore-state",
    });
    AOT.generate({ artifacts: { User }, outDir });
    const source = readFileSync(join(outDir, "index.js"), "utf8");
    const generated = (await import(pathToFileURL(join(outDir, "index.js")).href)) as {
      readonly User: {
        make(input: unknown): { id: string; name: string };
        readonly "restore-state": (state: { id: string; name: string }) => {
          id: string;
          name: string;
        };
      };
    };

    expect(source).toContain("static make(input)");
    expect(source).toContain('static ["restore-state"](state)');
    expect(generated.User.make({ id: "u_1", name: "Ada" })).toBeInstanceOf(generated.User);
    expect(generated.User["restore-state"]({ id: "u_1", name: "Ada" })).toBeInstanceOf(generated.User);
    expect("create" in generated.User).toBe(false);
    expect("hydrate" in generated.User).toBe(false);

    const typedOutDir = join(outDir, "typed");
    AOT.generate({ artifacts: { User }, outDir: typedOutDir, format: "ts" });
    const typedSource = readFileSync(join(typedOutDir, "index.ts"), "utf8");

    expect(typedSource).toContain('"make"<TThis');
    expect(typedSource).toContain('"restore-state"<TThis');
    expect(typedSource).not.toContain("create(input:");
    expect(typedSource).not.toContain("hydrate(state:");
    writeFileSync(
      join(typedOutDir, "consumer.ts"),
      [
        'import { User } from "./index.js";',
        'User.make({ id: "u_1", name: "Ada" });',
        'User["restore-state"]({ id: "u_1", name: "Ada" });',
        "// @ts-expect-error canonical aliases were explicitly renamed",
        'User.create({ id: "u_1", name: "Ada" });',
        "// @ts-expect-error hydration requires complete persisted state",
        'User["restore-state"]({ id: "u_1" });',
        "",
      ].join("\n")
    );
    writeFileSync(
      join(typedOutDir, "tsconfig.json"),
      JSON.stringify({
        compilerOptions: {
          exactOptionalPropertyTypes: true,
          module: "NodeNext",
          moduleResolution: "NodeNext",
          noEmit: true,
          strict: true,
          target: "ES2022",
        },
        include: ["index.ts", "consumer.ts"],
      })
    );
    writeFileSync(join(typedOutDir, "package.json"), '{"type":"module"}\n');

    expect(() =>
      execFileSync(process.execPath, [join(process.cwd(), "node_modules", "typescript", "bin", "tsc")], {
        cwd: typedOutDir,
        stdio: "pipe",
      })
    ).not.toThrow();
  });

  it("co-emits Runtime Classes for AOT JSON construction pipelines", async () => {
    const User = JIT.class(JIT.object({ id: JIT.string(), name: JIT.string() }));
    const parseUser = JIT.json.parse(User).validate();
    const result = AOT.generate({
      groups: {},
      artifacts: { User, parseUser },
      outDir,
    });
    const source = readFileSync(join(outDir, "index.js"), "utf8");
    const generated = (await import(pathToFileURL(join(outDir, "index.js")).href)) as {
      readonly User: new (state: {
        id: string;
        name: string;
      }) => {
        id: string;
        name: string;
      };
      readonly parseUser: (json: string) => { id: string; name: string };
    };
    const user = generated.parseUser('{"id":"u_1","name":"Ada"}');

    expect(result.skipped).toHaveLength(0);
    expect(source).toContain("new User(r.data, true)");
    expect(source).toMatchSnapshot("AOT JSON Runtime Class construction");
    expect(user).toBeInstanceOf(generated.User);
    expect(user).toEqual({ id: "u_1", name: "Ada" });
  });

  it("refuses AOT class-construction pipelines without their named class artifact", () => {
    const User = JIT.class(JIT.object({ id: JIT.string() }));
    const result = AOT.generate({
      groups: {},
      artifacts: { parseUser: JIT.json.parse(User).validate() },
      outDir,
    });

    expect(result.files).toEqual([]);
    expect(result.skipped).toEqual([
      {
        schema: "parseUser",
        operation: "construct",
        reason: "AOT class construction requires exporting the Runtime Class artifact alongside the execution pipeline",
      },
    ]);
  });

  it("should preserve private accessor storage in import-free runtime classes", async () => {
    const User = JIT.class(JIT.object({ id: JIT.string(), name: JIT.string() })).accessors({
      default: { field: "private", get: "public", set: false },
    });
    const result = AOT.generate({ groups: {}, artifacts: { User }, outDir });
    const source = readFileSync(join(outDir, "index.js"), "utf8");
    const generated = (await import(pathToFileURL(join(outDir, "index.js")).href)) as {
      readonly User: {
        create(input: { id: string; name: string }): {
          id: string;
          name: string;
        };
      };
    };
    const user = generated.User.create({ id: "u_1", name: "Ada" });

    expect(result.skipped).toHaveLength(0);
    expect(source).toContain("#p0;");
    expect(Object.keys(user)).toEqual([]);
    expect(user).toMatchObject({ id: "u_1", name: "Ada" });
  });

  it("should lower domain events without the JIT runtime", async () => {
    const OrderConfirmed = JIT.ddd.domainEvent("order.confirmed", {
      version: 1,
      payload: JIT.object({ orderId: JIT.string() }),
    });
    const result = AOT.generate({
      groups: {},
      artifacts: { OrderConfirmed },
      outDir,
    });
    const generated = (await import(pathToFileURL(join(outDir, "index.js")).href)) as {
      readonly OrderConfirmed: {
        readonly type: string;
        readonly version: number;
        create(input: { orderId: string }): {
          readonly payload: { readonly orderId: string };
          readonly "~event": {
            readonly version: 1;
            readonly type: string;
            readonly schemaVersion: number;
          };
        };
      };
    };

    expect(result.skipped).toHaveLength(0);
    expect(generated.OrderConfirmed.type).toBe("order.confirmed");
    expect(generated.OrderConfirmed.version).toBe(1);
    expect(generated.OrderConfirmed.create({ orderId: "o_1" })).toMatchObject({
      type: "order.confirmed",
      version: 1,
      payload: { orderId: "o_1" },
    });
    expect(generated.OrderConfirmed.create({ orderId: "o_1" })["~event"]).toEqual({
      version: 1,
      type: "order.confirmed",
      schemaVersion: 1,
    });
  });

  it("should expose only the canonical DomainEvent factories in typed AOT modules", () => {
    const OrderConfirmed = JIT.ddd.domainEvent("order.confirmed", {
      version: 1,
      payload: JIT.object({ orderId: JIT.string() }),
    });
    const typedOutDir = join(outDir, "typed");

    AOT.generate({
      groups: {},
      artifacts: { OrderConfirmed },
      outDir: typedOutDir,
      format: "ts",
    });
    const source = readFileSync(join(typedOutDir, "index.ts"), "utf8");

    expect(source).toContain("create(input: { orderId: string })");
    expect(source).not.toContain('readonly "new"');
    writeFileSync(
      join(typedOutDir, "consumer.ts"),
      [
        'import { OrderConfirmed } from "./index.js";',
        'OrderConfirmed.create({ orderId: "o_1" });',
        "// @ts-expect-error payload fields are required",
        "OrderConfirmed.create({});",
        "",
      ].join("\n")
    );
    writeFileSync(
      join(typedOutDir, "tsconfig.json"),
      JSON.stringify({
        compilerOptions: {
          exactOptionalPropertyTypes: true,
          module: "NodeNext",
          moduleResolution: "NodeNext",
          noEmit: true,
          strict: true,
          target: "ES2022",
        },
        include: ["index.ts", "consumer.ts"],
      })
    );
    writeFileSync(join(typedOutDir, "package.json"), '{"type":"module"}\n');

    expect(() =>
      execFileSync(process.execPath, [join(process.cwd(), "node_modules", "typescript", "bin", "tsc")], {
        cwd: typedOutDir,
        stdio: "pipe",
      })
    ).not.toThrow();
  });

  it("should preserve DDD capabilities and protected raise in typed AOT modules", () => {
    const Money = JIT.ddd.valueObject(JIT.object({ amount: JIT.number(), currency: JIT.string() }));
    const UserBase = JIT.ddd.entity(JIT.object({ id: JIT.string(), name: JIT.string() }), { id: "id" });
    const OrderBase = JIT.ddd.aggregateRoot(
      JIT.object({
        id: JIT.string().readonly(),
        status: JIT.enum(["draft", "confirmed"] as const),
      }),
      { id: "id" }
    );
    const typedOutDir = join(outDir, "typed-ddd");

    AOT.generate({
      artifacts: { Money, UserBase, OrderBase },
      outDir: typedOutDir,
      format: "ts",
    });
    writeFileSync(
      join(typedOutDir, "consumer.ts"),
      [
        'import { Money, OrderBase, UserBase } from "./index.js";',
        'Money.create({ amount: 10, currency: "BRL" }).equals(Money.create({ amount: 10, currency: "BRL" }));',
        "class User extends UserBase {}",
        'User.create({ id: "u_1", name: "Ada" }).sameIdentity(User.create({ id: "u_1", name: "Grace" }));',
        "class Order extends OrderBase {",
        '  confirm() { this.update({ status: "confirmed" }); this.raise({ type: "order.confirmed" }); }',
        "}",
        'const order = Order.create({ id: "o_1", status: "draft" });',
        "order.confirm();",
        "order.peekEvents();",
        "// @ts-expect-error raise is domain-internal",
        'order.raise({ type: "external" });',
        "// @ts-expect-error readonly identity is excluded from aggregate patches",
        'order.update({ id: "o_2" });',
        "",
      ].join("\n")
    );
    writeFileSync(
      join(typedOutDir, "tsconfig.json"),
      JSON.stringify({
        compilerOptions: {
          exactOptionalPropertyTypes: true,
          module: "NodeNext",
          moduleResolution: "NodeNext",
          noEmit: true,
          strict: true,
          target: "ES2022",
        },
        include: ["index.ts", "consumer.ts"],
      })
    );
    writeFileSync(join(typedOutDir, "package.json"), '{"type":"module"}\n');

    expect(() =>
      execFileSync(process.execPath, [join(process.cwd(), "node_modules", "typescript", "bin", "tsc")], {
        cwd: typedOutDir,
        stdio: "pipe",
      })
    ).not.toThrow();
  });

  it("should round-trip domain events through AOT JSON construction", async () => {
    const OrderConfirmed = JIT.ddd.domainEvent("order.confirmed", {
      version: 1,
      payload: JIT.object({ orderId: JIT.string() }),
    });
    const parseEvent = JIT.json.parse(OrderConfirmed).validate();
    const result = AOT.generate({
      groups: {},
      artifacts: { OrderConfirmed, parseEvent },
      outDir,
    });
    const generated = (await import(pathToFileURL(join(outDir, "index.js")).href)) as {
      readonly OrderConfirmed: { new (state: unknown): { occurredAt: Date } };
      readonly parseEvent: (json: string) => { occurredAt: Date };
    };
    expect(result.skipped).toEqual([]);
    const json = JIT.json.stringify(OrderConfirmed)(OrderConfirmed.create({ orderId: "o_1" }));
    const restored = generated.parseEvent(json);

    expect(restored).toBeInstanceOf(generated.OrderConfirmed);
    expect(restored.occurredAt).toBeInstanceOf(Date);
  });

  it("should lower aggregate infrastructure into an extendable import-free base", async () => {
    const OrderBase = JIT.ddd.aggregateRoot(
      JIT.object({
        id: JIT.string().readonly().default("o_1"),
        status: JIT.enum(["draft", "confirmed"] as const),
        shipping: JIT.object({ city: JIT.string(), country: JIT.string() }),
      }),
      { id: "id" }
    );
    const result = AOT.generate({
      groups: {},
      artifacts: { OrderBase },
      outDir,
    });
    const source = readFileSync(join(outDir, "index.js"), "utf8");
    type OrderBaseConstructor = {
      new (
        state: unknown
      ): {
        update(patch: { status?: "confirmed"; shipping?: { city?: string; country?: string } }): void;
        raise(event: unknown): void;
        pullEvents(): unknown[];
        commit(publisher: { publish(event: unknown): void | Promise<void> }): Promise<void>;
      };
      create(input: {
        status: "draft" | "confirmed";
        shipping: { city: string; country: string };
      }): InstanceType<new (state: unknown) => unknown>;
    };
    const generated = (await import(pathToFileURL(join(outDir, "index.js")).href)) as {
      readonly OrderBase: OrderBaseConstructor;
    };

    class Order extends generated.OrderBase {
      confirm() {
        this.update({ status: "confirmed" });
        this.raise({ type: "order.confirmed" });
      }
    }

    const order = Order.create({
      status: "draft",
      shipping: { city: "Recife", country: "BR" },
    }) as Order;

    expect(result.skipped).toHaveLength(0);
    expect(source).toMatchSnapshot("AOT aggregate mutation and event buffer");
    order.confirm();
    expect(order.pullEvents()).toEqual([{ type: "order.confirmed" }]);
    expect((order as Order & { status: string }).status).toBe("confirmed");
    order.update({ id: "o_2" } as never);
    expect((order as Order & { id: string }).id).toBe("o_1");
    order.update({ shipping: { city: "Sao Paulo" } });
    expect((order as Order & { shipping: { city: string; country: string } }).shipping).toEqual({
      city: "Sao Paulo",
      country: "BR",
    });
    order.raise({ type: "order.persisted" });
    await order.commit({ publish: () => undefined });
    expect(order.pullEvents()).toEqual([]);
  });

  it("should emit aggregate timestamp mutations without the runtime", async () => {
    const OrderBase = JIT.ddd
      .aggregateRoot(
        JIT.object({
          id: JIT.string(),
          status: JIT.string(),
          updatedAt: JIT.date(),
        }),
        {
          id: "id",
        }
      )
      .timestamps({ updatedAt: "updatedAt" });
    AOT.generate({ groups: {}, artifacts: { OrderBase }, outDir });
    const generated = (await import(pathToFileURL(join(outDir, "index.js")).href)) as {
      readonly OrderBase: {
        new (
          input: unknown
        ): {
          update(patch: { status: string }): void;
          updatedAt: Date;
        };
        create(input: { id: string; status: string; updatedAt: Date }): {
          update(patch: { status: string }): void;
          updatedAt: Date;
        };
      };
    };
    class Order extends generated.OrderBase {}
    const initial = new Date(0);
    const order = Order.create({
      id: "o_1",
      status: "draft",
      updatedAt: initial,
    });

    order.update({ status: "confirmed" });
    expect(order.updatedAt.getTime()).toBeGreaterThan(initial.getTime());
  });

  it("should emit soft-delete metadata with a shared timestamp instant", async () => {
    const OrderBase = JIT.ddd
      .aggregateRoot(
        JIT.object({
          id: JIT.string(),
          updatedAt: JIT.date(),
          deletedAt: JIT.date().nullable(),
        }),
        {
          id: "id",
        }
      )
      .timestamps({ updatedAt: "updatedAt" })
      .softDelete({ field: "deletedAt" });
    AOT.generate({ groups: {}, artifacts: { OrderBase }, outDir });
    const generated = (await import(pathToFileURL(join(outDir, "index.js")).href)) as {
      readonly OrderBase: {
        new (
          input: unknown
        ): {
          softDelete(): void;
          restore(): void;
          readonly isDeleted: boolean;
          updatedAt: Date;
          deletedAt: Date | null;
        };
      };
    };
    class Order extends generated.OrderBase {}
    const order = new Order({
      id: "o_1",
      updatedAt: new Date(0),
      deletedAt: null,
    });

    order.softDelete();
    expect(order.isDeleted).toBe(true);
    expect(order.deletedAt).toBe(order.updatedAt);
    order.restore();
    expect(order.isDeleted).toBe(false);
  });

  it("should lower static CQRS queries through the existing query artifact", async () => {
    const User = JIT.object({ id: JIT.string(), active: JIT.boolean() });
    const activeUsers = JIT.cqrs
      .query(User)
      .where((query) => query.eq("active", true))
      .select("id");
    const result = AOT.generate({
      groups: {},
      artifacts: { activeUsers },
      outDir,
    });
    const generated = (await import(pathToFileURL(join(outDir, "index.js")).href)) as {
      readonly activeUsers: (users: { id: string; active: boolean }[]) => { id: string }[];
    };

    expect(result.skipped).toHaveLength(0);
    expect(
      generated.activeUsers([
        { id: "a", active: true },
        { id: "b", active: false },
      ])
    ).toEqual([{ id: "a" }]);
  });

  it("should lower structural distinct with standalone hash and equality", async () => {
    const User = JIT.object({
      id: JIT.number(),
      profile: JIT.object({ active: JIT.boolean() }),
    });
    const distinctUsers = JIT.cqrs.query(User).distinct();
    const distinctIterator = distinctUsers.to.iterator();
    const result = AOT.generate({
      artifacts: { distinctUsers, distinctIterator },
      outDir,
    });
    const source = readFileSync(join(outDir, "index.js"), "utf8");
    const generated = (await import(pathToFileURL(join(outDir, "index.js")).href)) as {
      readonly distinctUsers: (users: { id: number; profile: { active: boolean } }[]) => unknown[];
      readonly distinctIterator: (users: { id: number; profile: { active: boolean } }[]) => IterableIterator<unknown>;
    };

    expect(result.skipped).toHaveLength(0);
    expect(source).toContain("const hash = __distinctHash(item)");
    expect(source).toContain("__distinctEqual(bucket[i], item)");
    expect(source).not.toContain('from "@jit-compiler/jit"');
    expect(source).not.toContain("JSON.stringify");
    expect(source).not.toContain("__hashCache");
    expect(
      generated.distinctUsers([
        { id: 1, profile: { active: true } },
        { id: 1, profile: { active: true } },
        { id: 2, profile: { active: false } },
      ])
    ).toEqual([
      { id: 1, profile: { active: true } },
      { id: 2, profile: { active: false } },
    ]);
    expect([
      ...generated.distinctIterator([
        { id: 1, profile: { active: true } },
        { id: 1, profile: { active: true } },
      ]),
    ]).toHaveLength(1);
  });

  it("should lower a join to an import-free physical program", async () => {
    const Order = JIT.object({ id: JIT.number(), customerId: JIT.string() });
    const Customer = JIT.object({ id: JIT.string(), name: JIT.string() });
    const joinOrders = JIT.cqrs.query(Order).join(JIT.array(Customer).keyed("id")).on("customerId", "id");
    const result = AOT.generate({ artifacts: { joinOrders }, outDir });
    const source = readFileSync(join(outDir, "index.js"), "utf8");
    const generated = (await import(pathToFileURL(join(outDir, "index.js")).href)) as {
      readonly joinOrders: (
        orders: { id: number; customerId: string }[],
        customers: { id: string; name: string }[]
      ) => {
        left: { id: number; customerId: string };
        right: { id: string; name: string };
      }[];
    };

    expect(result.skipped).toHaveLength(0);
    expect(source).not.toContain('from "@jit-compiler/jit"');
    expect(source).not.toContain(".find(");
    expect(source).not.toContain("resolveHints");
    expect(source).toContain("__cachedIndex(right,");
    expect(generated.joinOrders([{ id: 1, customerId: "c1" }], [{ id: "c1", name: "Ada" }])).toEqual([
      { left: { id: 1, customerId: "c1" }, right: { id: "c1", name: "Ada" } },
    ]);
  });

  it("should lower compatible ordering directly to a merge join", async () => {
    const Order = JIT.object({ customerId: JIT.number(), total: JIT.number() });
    const Customer = JIT.object({ id: JIT.number(), name: JIT.string() });
    const mergeOrders = JIT.cqrs
      .query(JIT.array(Order).ordered("customerId", "asc"))
      .join(JIT.array(Customer).ordered("id", "asc"))
      .on("customerId", "id");
    const mergeDir = join(outDir, "merge");
    const result = AOT.generate({
      artifacts: { mergeOrders },
      outDir: mergeDir,
    });
    const source = readFileSync(join(mergeDir, "index.js"), "utf8");
    const generated = (await import(pathToFileURL(join(mergeDir, "index.js")).href)) as {
      readonly mergeOrders: (
        orders: { customerId: number; total: number }[],
        customers: { id: number; name: string }[]
      ) => unknown[];
    };

    expect(result.skipped).toHaveLength(0);
    expect(source).toContain("while (i < leftLen && j < rightLen)");
    expect(source).not.toContain("new Map()");
    expect(source).not.toContain("__cachedIndex");
    expect(source).not.toContain("MergeJoin");
    expect(
      generated.mergeOrders(
        [
          { customerId: 1, total: 10 },
          { customerId: 2, total: 20 },
        ],
        [
          { id: 1, name: "Ada" },
          { id: 2, name: "Lin" },
        ]
      )
    ).toHaveLength(2);
  });

  it("should preserve transform, update, and security stages in an import-free composed pipeline", async () => {
    const User = JIT.object({
      id: JIT.number().int32(),
      role: JIT.enum(["admin", "member"] as const),
      name: JIT.string(),
      email: JIT.string().pii("mask"),
      note: JIT.string().sanitize(),
    });
    const publicUsers = JIT.json
      .parse(JIT.array(User))
      .validate()
      .transform(User, { name: (name) => name.trim().toUpperCase() })
      .update({ name: "PUBLIC" })
      .sanitize()
      .mask()
      .filter((query) => query.eq("role", "admin"))
      .select("id", "name", "email", "note")
      .to.json();
    const result = AOT.generate({
      groups: {},
      artifacts: { publicUsers },
      outDir,
    });
    const source = readFileSync(join(outDir, "index.js"), "utf8");
    const generated = (await import(pathToFileURL(join(outDir, "index.js")).href)) as {
      readonly publicUsers: (json: string) => string;
    };

    expect(result.skipped).toHaveLength(0);
    expect(source).toContain("function update(value, patch)");
    expect(source).toContain("function transform(value)");
    expect(source).not.toContain('from "@jit-compiler/jit"');
    expect(
      generated.publicUsers('[{"id":1,"role":"admin","name":" Ada ","email":"ada@math.org","note":"<b>ok</b>"}]')
    ).toBe('[{"id":1,"name":"PUBLIC","email":"***.org","note":"ok"}]');
  });

  it("should emit filtered terminal aggregates as one import-free AOT loop", async () => {
    const Orders = JIT.array(
      JIT.object({
        id: JIT.number().int32(),
        active: JIT.boolean(),
        total: JIT.number(),
      })
    );
    const activeTotal = JIT.from(Orders)
      .filter((query) => query.eq("active", true))
      .sum("total");
    const result = AOT.generate({
      groups: {},
      artifacts: { activeTotal },
      outDir,
      format: "ts",
    });
    const source = readFileSync(join(outDir, "index.ts"), "utf8");
    const generated = (await import(pathToFileURL(join(outDir, "index.ts")).href)) as {
      readonly activeTotal: (orders: readonly { id: number; active: boolean; total: number }[]) => number;
    };

    expect(result.skipped).toHaveLength(0);
    expect(source).not.toContain('from "@jit-compiler/jit"');
    expect(source).not.toContain("new Array");
    expect(source).toContain("let acc = 0");
    expect(
      generated.activeTotal([
        { id: 1, active: true, total: 10 },
        { id: 2, active: false, total: 100 },
        { id: 3, active: true, total: 20 },
      ])
    ).toBe(30);
  });

  it("should emit the source input and target output types for a transformed value artifact", async () => {
    const Wire = JIT.object({ id: JIT.number(), name: JIT.string() });
    const Domain = JIT.object({ id: JIT.string(), name: JIT.string() });
    const toDomain = JIT.from(Wire).transform(Domain, {
      id: (id) => String(id),
    });

    const result = AOT.generate({
      groups: {},
      artifacts: { toDomain },
      outDir,
      format: "ts",
    });
    const source = readFileSync(join(outDir, "index.ts"), "utf8");
    const generated = (await import(pathToFileURL(join(outDir, "index.ts")).href)) as {
      readonly toDomain: (value: { id: number; name: string }) => {
        id: string;
        name: string;
      };
    };

    expect(result.skipped).toHaveLength(0);
    expect(generated.toDomain({ id: 1, name: "Ada" })).toEqual({
      id: "1",
      name: "Ada",
    });
    expect(source).toContain("const toDomain: (value: { id: number; name: string }) => { id: string; name: string } =");
  });

  it("should fuse terminal batch mapping and JSON encoding without a mapped output array", async () => {
    const Entity = JIT.object({ id: JIT.number(), fullName: JIT.string() });
    const Public = JIT.object({ id: JIT.number(), name: JIT.string() });
    const publicJson = JIT.map.many(Entity, Public, { name: { from: "fullName" } }).to.json();
    const result = AOT.generate({
      groups: {},
      artifacts: { publicJson },
      outDir,
    });
    const source = readFileSync(join(outDir, "index.js"), "utf8");
    const generated = (await import(pathToFileURL(join(outDir, "index.js")).href)) as {
      readonly publicJson: (value: readonly { id: number; fullName: string }[]) => string;
    };

    expect(result.skipped).toHaveLength(0);
    expect(generated.publicJson([{ id: 1, fullName: "Ada" }])).toBe('[{"id":1,"name":"Ada"}]');
    expect(source).toContain("let mappedJson");
    expect(source).not.toContain("function many(list)");
  });

  it("should generate a standalone runnable module for callback-free operations", async () => {
    const Event = JIT.object({
      id: JIT.number(),
      kind: JIT.literal("click"),
      target: JIT.string().pii(),
      body: JIT.string().sanitize(),
      at: JIT.date(),
    });
    const WireEvent = JIT.object({
      id: JIT.number(),
      kind: JIT.literal("click"),
      target: JIT.string(),
    });
    const result = AOT.generate({
      artifacts: {
        Event_equal: JIT.compare.equal(Event),
        Event_clone: JIT.clone(Event),
        Event_diff: JIT.compare.diff(Event),
        Event_stringify: JIT.json.stringify(Event),
        Event_fromJSON: JIT.json.parse(WireEvent).validate(),
        Event_mask: JIT.security.mask(Event),
        Event_sanitize: JIT.security.sanitize(Event),
        Event_codec: JIT.binary.codec(Event),
      },
      outDir,
    });
    const source = readFileSync(join(outDir, "index.js"), "utf8");

    expect(source).not.toContain('from "@jit-compiler/jit"');
    expect(source).toContain("JSON.parse");
    expect(result.skipped).toHaveLength(0);

    const generated = (await import(pathToFileURL(join(outDir, "index.js")).href)) as {
      Event_equal: (left: unknown, right: unknown) => boolean;
      Event_clone: <T>(value: T) => T;
      Event_diff: (left: unknown, right: unknown) => readonly unknown[];
      Event_stringify: (value: unknown) => string;
      Event_fromJSON: (json: string) => unknown;
      Event_mask: <T>(value: T) => T;
      Event_sanitize: <T>(value: T) => T;
      Event_codec: {
        encode: (value: unknown) => Uint8Array;
        decode: (bytes: Uint8Array) => unknown;
      };
    };

    const event = {
      id: 7,
      kind: "click" as const,
      target: "secret-target",
      body: "<script>x()</script>hello",
      at: new Date("2026-07-05T00:00:00.000Z"),
    };

    expect(generated.Event_equal(event, { ...event })).toBe(true);
    expect(generated.Event_clone(event)).toEqual(event);
    expect(generated.Event_diff(event, { ...event, target: "next" })).toEqual([
      { type: "update", path: ["target"], value: "next" },
    ]);
    expect(generated.Event_stringify(event)).toBe(JSON.stringify(event));
    expect(generated.Event_fromJSON('{"id":7,"kind":"click","target":"next"}')).toEqual({
      id: 7,
      kind: "click",
      target: "next",
    });
    expect(() => generated.Event_fromJSON('{"id":7}')).toThrow(/expected literal click/);
    expect(generated.Event_mask(event).target).toBe("***");
    expect(generated.Event_sanitize(event).body).toBe("hello");
    expect(generated.Event_codec.decode(generated.Event_codec.encode(event))).toEqual(event);
  });

  it("should re-emit binary rowset queries as import-free AOT source", async () => {
    const User = JIT.object({
      id: JIT.number().int32(),
      role: JIT.union(JIT.literal("admin"), JIT.literal("user")),
      active: JIT.boolean(),
      score: JIT.number().float32(),
    });
    const Users = JIT.array(User);
    const binary = Users.binary({
      strategy: "exact",
      memoryLayout: "columnar",
    });
    const rowset = binary.load([
      { id: 1, role: "admin" as const, active: true, score: 10 },
      { id: 2, role: "user" as const, active: true, score: 7 },
      { id: 3, role: "admin" as const, active: false, score: 3 },
    ]);
    const ActiveAdmins = JIT.query(rowset)
      .filter((q) => q.and(q.eq("role", "admin"), q.eq("active", true)))
      .select("id", "score");

    const result = AOT.generate({
      groups: {},
      artifacts: { ActiveAdmins },
      outDir,
    });
    const source = readFileSync(join(outDir, "index.js"), "utf8");
    const generated = (await import(pathToFileURL(join(outDir, "index.js")).href)) as {
      ActiveAdmins: (value: typeof rowset) => { readonly id: number; readonly score: number }[];
    };

    expect(result.skipped).toHaveLength(0);
    expect(source).not.toContain('from "@jit-compiler/jit"');
    expect(source).toContain("function query(rowset)");
    expect(source).toContain("const offsets = rowset.offsets");
    expect(source).toContain("u8[b0 + i]");
    expect(source).toContain("int32[b2 + i]");
    expect(source).not.toContain("rowset.view");
    expect(generated.ActiveAdmins(rowset)).toEqual([{ id: 1, score: 10 }]);
  });

  it("should re-emit lazy iterators and direct visitors as import-free AOT source", async () => {
    const User = JIT.object({
      id: JIT.number().int32(),
      active: JIT.boolean(),
    });
    const Users = JIT.array(User);
    const ActiveIds = JIT.query(Users)
      .filter((q) => q.eq("active", true))
      .select("id")
      .take(2)
      .to.iterator();
    const VisitActiveIds = JIT.query(Users)
      .filter((q) => q.eq("active", true))
      .select("id")
      .to.visitor();
    const result = AOT.generate({
      groups: {},
      artifacts: { ActiveIds, VisitActiveIds },
      outDir,
    });
    const source = readFileSync(join(outDir, "index.js"), "utf8");
    const generated = (await import(pathToFileURL(join(outDir, "index.js")).href)) as {
      ActiveIds: (input: readonly { id: number; active: boolean }[]) => IterableIterator<{ id: number }>;
      VisitActiveIds: (
        input: readonly { id: number; active: boolean }[],
        consume: (value: { id: number }) => void
      ) => number;
    };
    const users = [
      { id: 1, active: true },
      { id: 2, active: false },
      { id: 3, active: true },
      { id: 4, active: true },
    ];
    const visited: number[] = [];

    expect(result.skipped).toHaveLength(0);
    expect(source).not.toContain('from "@jit-compiler/jit"');
    expect(source).toContain("function* stage0(input, params)");
    expect(source).toContain("function visit(input, consume)");
    expect([...generated.ActiveIds(users)]).toEqual([{ id: 1 }, { id: 3 }]);
    expect(generated.VisitActiveIds(users, (value) => visited.push(value.id))).toBe(3);
    expect(visited).toEqual([1, 3, 4]);
  });

  it("should re-emit callback-free watched collection diffs", async () => {
    const User = JIT.object({ id: JIT.number(), name: JIT.string() });
    const Users = JIT.array(User);
    const UserChanges = JIT.watch(Users, { key: "id" });
    const UserCollection = { changes: UserChanges };
    const result = AOT.generate({
      groups: { UserCollection },
      artifacts: { UserChanges },
      outDir,
    });
    const source = readFileSync(join(outDir, "index.js"), "utf8");
    const generated = (await import(pathToFileURL(join(outDir, "index.js")).href)) as {
      UserCollection: { changes: typeof UserChanges };
      UserChanges: typeof UserChanges;
    };
    const ada = { id: 1, name: "Ada" };
    const grace = { id: 2, name: "Grace" };
    const adaUpdated = { id: 1, name: "Ada Lovelace" };

    expect(result.skipped).toHaveLength(0);
    expect(source).not.toContain('from "@jit-compiler/jit"');
    expect(source).toContain("function watch(previous, current)");
    expect(source).toContain("const previousIndex = new Map();");
    expect(generated.UserChanges([ada, grace], [adaUpdated])).toEqual({
      currentItems: [adaUpdated],
      initialItems: [ada, grace],
      newItems: [],
      removedItems: [grace],
      updatedItems: [{ previous: ada, current: adaUpdated }],
      isChanged: true,
    });
    expect(generated.UserCollection.changes([ada], [ada])).toEqual({
      currentItems: [ada],
      initialItems: [ada],
      newItems: [],
      removedItems: [],
      updatedItems: [],
      isChanged: false,
    });
  });

  it("should serialize watched collection callbacks into self-contained AOT bindings", async () => {
    const User = JIT.object({ id: JIT.number() });
    const Users = JIT.array(User);
    const hooks = {
      onAdd(_value: { id: number }) {
        return undefined;
      },
    };
    const UserChanges = JIT.watch(Users, { key: "id", onAdd: hooks.onAdd });
    const result = AOT.generate({
      groups: {},
      artifacts: { UserChanges },
      outDir,
    });
    const source = readFileSync(join(outDir, "index.js"), "utf8");
    const generated = (await import(pathToFileURL(join(outDir, "index.js")).href)) as {
      UserChanges: typeof UserChanges;
    };

    expect(result.skipped).toHaveLength(0);
    expect(source).toContain("const __w0 = (function onAdd(_value)");
    expect(generated.UserChanges([], [{ id: 1 }]).newItems).toEqual([{ id: 1 }]);
  });

  it("should serialize default, refine, and transform callbacks into AOT validators", async () => {
    const User = JIT.object({
      name: JIT.string().default(() => "'"),
    })
      .transform({
        name: (value) => String(value).trim(),
      })
      .refine((value) => value.name !== "blocked");
    const result = AOT.generate({
      groups: {},
      artifacts: {
        isUser: JIT.validate.is(User),
        parseUser: JIT.validate.parse(User),
        safeParseUser: JIT.validate.safeParse(User),
      },
      outDir,
    });
    const source = readFileSync(join(outDir, "index.js"), "utf8");
    const generated = (await import(pathToFileURL(join(outDir, "index.js")).href)) as {
      isUser: (value: unknown) => boolean;
      parseUser: (value: unknown) => { name: string };
      safeParseUser: (value: unknown) => { success: boolean };
    };

    expect(result.skipped).toHaveLength(0);
    expect(source).toContain(`(() => "'")`);
    expect(source).toContain("((value) => String(value).trim())");
    expect(source).toContain('((value) => value.name !== "blocked")');
    expect(generated.isUser({ name: " Ada " })).toBe(true);
    expect(generated.parseUser({ name: " Ada " })).toEqual({ name: "Ada" });
    expect(generated.parseUser({})).toEqual({ name: "'" });
    expect(generated.safeParseUser({ name: "blocked" }).success).toBe(false);
  });

  it("should reject callbacks with inaccessible closure dependencies", () => {
    const minimum = 2;
    const Name = JIT.string().refine((value) => value.length >= minimum);
    const result = AOT.generate({
      groups: {},
      artifacts: { isName: JIT.validate.is(Name) },
      outDir,
    });

    expect(result.files).toEqual([]);
    expect(result.skipped).toContainEqual({
      schema: "isName",
      operation: "is",
      reason: "refine/transform/default callbacks cannot be serialized ahead of time",
    });
  });

  it("should generate validator flat exports with inlined regex bindings", () => {
    const User = JIT.object({
      id: JIT.number().int(),
      email: JIT.string().email(),
      plan: JIT.string().default("free"),
    });

    const result = AOT.generate({
      groups: {},
      artifacts: {
        User_is: JIT.validate.is(User),
        User_parse: JIT.validate.parse(User),
        User_safeParse: JIT.validate.safeParse(User),
      },
      outDir,
      format: "ts",
    });
    const source = readFileSync(join(outDir, "index.ts"), "utf8");

    expect(result.skipped).toHaveLength(0);
    expect(source).toContain("const User_is_validator = /*#__PURE__*/ (() => {");
    expect(source).toContain("const User_parse_validator = /*#__PURE__*/ (() => {");
    expect(source).toContain("const User_safeParse_validator = /*#__PURE__*/ (() => {");
    expect(source).toContain("function is(value)");
    expect(source).toContain("function safeParse(value)");
    expect(source).toContain("class JITValidationError extends Error");
    expect(source).not.toContain("import ");
    expect(source).toContain("= /*#__PURE__*/ ((v) => v.is)(User_is_validator);");
    expect(source).not.toContain("const User = /*#__PURE__*/ Object.freeze({");

    expect(source).not.toContain("export type User =");
    expect(source).toContain("id: number");
    expect(source).toContain("plan: string");
    expect(source).toContain("const User_is:");
    expect(source).toContain("const User_parse:");
    expect(source).toContain("const User_safeParse:");
    expect(source).not.toContain("const User: {");

    expect(existsSync(join(outDir, "package.json"))).toBe(false);
  });

  it("should preserve standalone export names when grouped internals would collide", async () => {
    const UserSchema = JIT.object({ id: JIT.number() });
    const isUser = JIT.validate.is(UserSchema);

    AOT.generate({
      groups: { User: { is: isUser } },
      artifacts: { User_is: isUser },
      outDir,
      format: "ts",
    });

    const source = readFileSync(join(outDir, "index.ts"), "utf8");
    const generated = (await import(pathToFileURL(join(outDir, "index.ts")).href)) as {
      User: { is: (value: unknown) => boolean };
      User_is: (value: unknown) => boolean;
    };

    expect(source).toContain("const User_is_1");
    expect(source).toContain("is: User_is_1");
    expect(source).toContain("const User_is:");
    expect(generated.User.is({ id: 1 })).toBe(true);
    expect(generated.User_is({ id: 1 })).toBe(true);
  });

  it("should emit standalone and grouped specialized formatters", async () => {
    const Document = JIT.string().format("###.###.###-##");
    const formatDocument = JIT.format(Document).compile();

    AOT.generate({
      groups: { Document: { format: formatDocument } },
      artifacts: { formatDocument },
      outDir,
      format: "ts",
    });

    const source = readFileSync(join(outDir, "index.ts"), "utf8");
    const generated = (await import(pathToFileURL(join(outDir, "index.ts")).href)) as {
      Document: { format: (value: string) => string };
      formatDocument: (value: string) => string;
    };

    expect(source).toContain("function format(value)");
    expect(source).not.toContain("safeParse");
    expect(source).toContain("readonly format: (value: string) => string");
    expect(generated.Document.format("12345678901")).toBe("123.456.789-01");
    expect(generated.formatDocument("12345678901")).toBe("123.456.789-01");
  });

  it("should report raw schemas as skipped instead of generating fallback functions", () => {
    const Weird = JIT.object({
      meta: JIT.mapSchema(JIT.string(), JIT.number()),
      hook: JIT.string().refine((value) => value.length > 0),
      open: JIT.any(),
    });

    const result = AOT.generate({ schemas: { Weird }, outDir });

    // A schema on its own declares a type, never a runtime function.
    expect(result.files).toHaveLength(0);
  });

  it("should honor build options that keep generated files minimal", () => {
    const User = JIT.object({ id: JIT.number(), name: JIT.string() });

    writeFileSync(join(outDir, "package.json"), '{"stale":true}\n');
    const isUser = JIT.validate.is(User);

    const result = AOT.generate({
      groups: {},
      artifacts: { User_is: isUser },
      outDir,
    });
    const source = readFileSync(join(outDir, "index.js"), "utf8");

    expect(result.files.map((file) => file.split("/").pop()).sort()).toEqual(["index.js"]);
    expect(readFileSync(join(outDir, "package.json"), "utf8")).toBe('{"stale":true}\n');
    expect(source).toContain("const User_is");
    expect(source).not.toContain("User_parse");
    expect(source).not.toContain("User_equal");
    expect(source).not.toContain("JITValidationError");
    expect(source).not.toContain("__hashCache");
    expect(source).not.toContain("__indexCache");
    expect(source).not.toContain("__getIndex");
    expect(source).not.toContain('from "@jit-compiler/jit"');
  });

  it("should inline cache helpers only for operations that need them", async () => {
    const User = JIT.object({ id: JIT.number(), name: JIT.string() });
    const PlainUsers = JIT.array(User);
    const IndexedUsers = JIT.array(User).entity({ key: "id" }).indexBy("id");
    const Hashed = JIT.object({ id: JIT.number(), name: JIT.string() }).hash("ordered");
    const plainDir = join(outDir, "plain");
    const indexedDir = join(outDir, "indexed");
    const hashedDir = join(outDir, "hashed");

    AOT.generate({
      groups: {},
      artifacts: { Plain_equal: JIT.compare.equal(PlainUsers) },
      outDir: plainDir,
    });

    const plainSource = readFileSync(join(plainDir, "index.js"), "utf8");

    expect(plainSource).not.toContain("__indexCache");
    expect(plainSource).not.toContain("__hashCache");

    AOT.generate({
      groups: {},
      artifacts: { Indexed_equal: JIT.compare.equal(IndexedUsers) },
      outDir: indexedDir,
    });

    const indexedSource = readFileSync(join(indexedDir, "index.js"), "utf8");
    const indexedGenerated = (await import(pathToFileURL(join(indexedDir, "index.js")).href)) as {
      Indexed_equal: (left: readonly unknown[], right: readonly unknown[]) => boolean;
    };
    const left = Array.from({ length: 70 }, (_, index) => ({
      id: index,
      name: `user-${index}`,
    }));
    const right = [...left].reverse();

    expect(indexedSource.match(/const __indexCache = new WeakMap\(\);/g)).toHaveLength(1);
    expect(indexedSource).toContain('__getIndex(r, "id")');
    expect(indexedSource).not.toContain("__hashCache");
    expect(indexedGenerated.Indexed_equal(left, right)).toBe(true);
    expect(indexedGenerated.Indexed_equal(left, right)).toBe(true);
    expect(
      indexedGenerated.Indexed_equal(
        left,
        right.map((user) => (user.id === 35 ? { ...user, name: "changed" } : user))
      )
    ).toBe(false);

    AOT.generate({
      artifacts: {
        Hashed_equal: JIT.compare.equal(Hashed),
        Hashed_hash: JIT.compare.hash(Hashed),
      },
      outDir: hashedDir,
    });

    const hashedSource = readFileSync(join(hashedDir, "index.js"), "utf8");
    const hashedGenerated = (await import(pathToFileURL(join(hashedDir, "index.js")).href)) as {
      Hashed_equal: (left: unknown, right: unknown) => boolean;
      Hashed_hash: (value: unknown) => number;
    };

    expect(hashedSource.match(/const __hashCache = new WeakMap\(\);/g)).toHaveLength(1);
    expect(hashedSource).not.toContain("__indexCache");
    expect(hashedGenerated.Hashed_equal({ id: 1, name: "Ada" }, { id: 1, name: "Ada" })).toBe(true);
    expect(hashedGenerated.Hashed_equal({ id: 1, name: "Ada" }, { id: 1, name: "Grace" })).toBe(false);
    expect(hashedGenerated.Hashed_hash({ id: 1, name: "Ada" })).toBe(
      hashedGenerated.Hashed_hash({ id: 1, name: "Ada" })
    );
  });

  it("should generate hash and hash-short-circuit equal with zero imports", async () => {
    const Hashed = JIT.object({ id: JIT.number(), name: JIT.string() }).hash("ordered");
    const result = AOT.generate({
      artifacts: {
        Hashed_equal: JIT.compare.equal(Hashed),
        Hashed_hash: JIT.compare.hash(Hashed),
      },
      outDir,
    });
    const source = readFileSync(join(outDir, "index.js"), "utf8");

    expect(result.skipped.filter((skip) => skip.operation === "equal")).toHaveLength(0);
    expect(source).toContain("const Hashed_hash");
    expect(source).toContain("const Hashed_equal_hash");
    expect(source).toContain("((__hash) => (");
    expect(source.match(/const __hashCache = new WeakMap\(\);/g)).toHaveLength(1);
    expect(source).not.toContain("import ");

    const generated = (await import(pathToFileURL(join(outDir, "index.js")).href)) as {
      Hashed_equal: (left: unknown, right: unknown) => boolean;
      Hashed_hash: (value: unknown) => number;
    };
    const ada = { id: 1, name: "Ada" };

    expect(generated.Hashed_equal(ada, { ...ada })).toBe(true);
    expect(generated.Hashed_equal(ada, { ...ada, name: "Grace" })).toBe(false);
    expect(generated.Hashed_hash(ada)).toBe(generated.Hashed_hash({ ...ada }));
    expect(generated.Hashed_hash(ada)).not.toBe(generated.Hashed_hash({ ...ada, name: "Grace" }));
  });

  it("should inline a JSON Schema document and a specialized mock generator", async () => {
    const User = JIT.object({
      id: JIT.number().int32().positive(),
      email: JIT.string().email(),
      role: JIT.union(JIT.literal("admin"), JIT.literal("member")),
    });
    const result = AOT.generate({
      artifacts: {
        userDocument: JIT.jsonSchema.to(User),
        mockUser: JIT.mock(User),
      },
      schemas: { User },
      outDir,
      format: "ts",
    });
    const source = readFileSync(join(outDir, "index.ts"), "utf8");

    expect(result.skipped).toHaveLength(0);
    // The document is static data: the translator never reaches the bundle.
    expect(source).toContain("const userDocument: { readonly [key: string]: unknown } = /*#__PURE__*/ Object.freeze({");
    expect(source).toContain('"format":"email"');
    expect(source).toContain("const mockUser: (options?: { readonly seed?: number }) => User =");
    expect(source).toContain("function __srand(seed)");
    expect(source).not.toContain('from "@jit-compiler/jit"');

    const generated = (await import(pathToFileURL(join(outDir, "index.ts")).href)) as {
      userDocument: { type: string; required: readonly string[] };
      mockUser: (options?: { seed?: number }) => {
        id: number;
        email: string;
        role: string;
      };
    };

    expect(generated.userDocument.type).toBe("object");
    expect(generated.userDocument.required).toEqual(["id", "email", "role"]);
    expect(JIT.validate.is(User)(generated.mockUser({ seed: 5 }))).toBe(true);
    expect(generated.mockUser({ seed: 5 })).toEqual(generated.mockUser({ seed: 5 }));
  });

  it("should lower a schema built from a JSON Schema document at generation time", async () => {
    const User = JIT.jsonSchema.from({
      type: "object",
      properties: {
        id: { type: "integer", minimum: 1 },
        name: { type: "string", minLength: 2 },
      },
      required: ["id", "name"],
    } as const);
    const result = AOT.generate({
      artifacts: {
        isUser: JIT.validate.is(User),
        toJson: JIT.json.stringify(User),
      },
      schemas: { User },
      outDir,
      format: "ts",
    });
    const source = readFileSync(join(outDir, "index.ts"), "utf8");

    expect(result.skipped).toHaveLength(0);
    // The document is build-time input: only specialized functions ship.
    expect(source).toContain("export type User = { id: number; name: string };");
    expect(source).not.toContain("properties");
    expect(source).not.toContain("$schema");

    const generated = (await import(pathToFileURL(join(outDir, "index.ts")).href)) as {
      isUser: (value: unknown) => boolean;
      toJson: (value: { id: number; name: string }) => string;
    };

    expect(generated.isUser({ id: 1, name: "Ada" })).toBe(true);
    expect(generated.isUser({ id: 0, name: "Ada" })).toBe(false);
    expect(generated.isUser({ id: 1, name: "A" })).toBe(false);
    expect(generated.toJson({ id: 1, name: "Ada" })).toBe('{"id":1,"name":"Ada"}');
  });

  it("should emit TypeScript types for nested and wrapped schemas", () => {
    const type = AOT.emitTypeScriptType(
      JIT.object({
        id: JIT.number(),
        nick: JIT.optional(JIT.string()),
        role: JIT.union(JIT.literal("admin"), JIT.literal("user")),
        status: JIT.string().oneOf(["active", "blocked"] as const),
        level: JIT.number().oneOf([1, 2, 3] as const),
        items: JIT.array(JIT.object({ sku: JIT.string() })),
      }).schema
    );

    expect(type).toBe(
      '{ id: number; nick: string | undefined; role: "admin" | "user"; status: "active" | "blocked"; level: 1 | 2 | 3; items: { sku: string }[] }'
    );

    expect(AOT.emitTypeScriptType(JIT.object({ id: JIT.number() }).readonly().schema)).toBe("Readonly<{ id: number }>");
  });

  it("should generate every structural operation for a self-referencing schema", async () => {
    const Node: never = JIT.object({
      value: JIT.number().int32(),
      label: JIT.string().min(1),
      children: JIT.array(JIT.lazy((): never => Node)),
    }) as never;
    const names = new Map([[(Node as { schema: unknown }).schema, "Node"]] as never);

    // A cycle is only expressible in TypeScript through a name.
    expect(AOT.emitTypeScriptType((Node as { schema: never }).schema, names as never)).toBe(
      "{ value: number; label: string; children: Node[] }"
    );

    AOT.generate({
      artifacts: {
        cloneNode: JIT.clone(Node),
        equalNode: JIT.compare.equal(Node),
        diffNode: JIT.compare.diff(Node),
        nodeToJson: JIT.json.stringify(Node),
        updateNode: JIT.update(Node).compile(),
        isNode: JIT.validate.is(Node),
      },
      outDir,
      format: "js",
    });

    const generated = (await import(pathToFileURL(join(outDir, "index.js")).href)) as Record<string, never>;
    const value = {
      value: 1,
      label: "root",
      children: [{ value: 2, label: "a", children: [] }],
    };
    const clone = (generated.cloneNode as (v: unknown) => typeof value)(value);
    const changed = {
      ...value,
      children: [{ value: 9, label: "a", children: [] }],
    };

    expect(clone).toEqual(value);
    expect(clone.children).not.toBe(value.children);
    expect((generated.equalNode as (a: unknown, b: unknown) => boolean)(clone, value)).toBe(true);
    expect((generated.equalNode as (a: unknown, b: unknown) => boolean)(changed, value)).toBe(false);
    expect((generated.diffNode as (a: unknown, b: unknown) => unknown[])(value, changed)).toEqual([
      { type: "update", path: ["children", 0, "value"], value: 9 },
    ]);
    expect((generated.nodeToJson as (v: unknown) => string)(value)).toBe(JSON.stringify(value));
    expect((generated.updateNode as (v: unknown, p: unknown) => typeof value)(value, { value: 7 }).value).toBe(7);
    expect((generated.isNode as (v: unknown) => boolean)(value)).toBe(true);
  });
});
