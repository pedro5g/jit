import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { createSecurityPipeline } from "../../__tests__/pipeline-fixture.js";
import { JIT as DefineJIT } from "../../define.js";
import { AOT, JIT } from "../../index.js";
import { registerAotTestHooks } from "./aot-test-utils.js";

let outDir: string;
registerAotTestHooks((directory) => {
  outDir = directory;
});

it("should preserve renamed DDD capability members in standalone AOT", async () => {
  const OrderBase = JIT.ddd
    .aggregateRoot(
      JIT.object({
        id: JIT.string(),
        changedAt: JIT.date(),
        archivedAt: JIT.date().nullable(),
      }),
      {
        id: "id",
      }
    )
    .extends(
      JIT.ddd.timestamps({
        updatedAt: "changedAt",
        methods: { touch: "markChanged" },
      }),
      JIT.ddd.softDelete({
        field: "archivedAt",
        methods: {
          delete: "archive",
          restore: "unarchive",
          isDeleted: "isArchived",
        },
      })
    );
  const result = AOT.generate({ groups: {}, artifacts: { OrderBase }, outDir });
  const generated = (await import(pathToFileURL(join(outDir, "index.js")).href)) as {
    readonly OrderBase: typeof OrderBase;
  };
  class Order extends generated.OrderBase {}
  const order = Order.create({ id: "o_1" });

  expect(result.skipped).toEqual([]);
  order.markChanged();
  order.archive();
  expect(order.isArchived).toBe(true);
  order.unarchive();
  expect(order.isArchived).toBe(false);
});

it("keeps structural DDD definitions reconstructive on the define host", async () => {
  const User = DefineJIT.ddd
    .entity(DefineJIT.object({ id: DefineJIT.string(), name: DefineJIT.string() }), { id: "id" })
    .extends(DefineJIT.ddd.timestamps(), DefineJIT.ddd.softDelete(), DefineJIT.ddd.versioned());
  const result = AOT.generate({ groups: {}, artifacts: { User }, outDir });
  const source = readFileSync(join(outDir, "index.js"), "utf8");
  const generated = (await import(pathToFileURL(join(outDir, "index.js")).href)) as {
    readonly User: {
      create(input: { id: string; name: string }): {
        id: string;
        name: string;
        createdAt: Date;
        updatedAt: Date | null;
        deletedAt: Date | null;
        version: number;
        touch(): void;
        softDelete(): void;
        restore(): void;
        readonly isDeleted: boolean;
      };
      hydrate(input: {
        id: string;
        name: string;
        createdAt: Date;
        updatedAt: Date | null;
        deletedAt: Date | null;
        version: number;
      }): unknown;
    };
  };
  const user = generated.User.create({ id: "u_1", name: "Ada" });

  expect(result.skipped).toEqual([]);
  expect(user.updatedAt).toBeNull();
  expect(user.deletedAt).toBeNull();
  expect(user.version).toBe(0);
  user.touch();
  expect(user.updatedAt).toBeInstanceOf(Date);
  expect(user.version).toBe(1);
  user.softDelete();
  expect(user.isDeleted).toBe(true);
  user.restore();
  expect(user.isDeleted).toBe(false);
  expect(
    generated.User.hydrate({
      id: "u_1",
      name: "Ada",
      createdAt: new Date(0),
      updatedAt: null,
      deletedAt: null,
      version: 0,
    })
  ).toBeDefined();
  expect(source).not.toContain("artifact-registry");
  expect(source).not.toContain("RuntimeClass");
});

it("keeps scalar DDD definitions reconstructive on the define host", async () => {
  const Email = DefineJIT.ddd.valueObject(DefineJIT.string().email());
  const UserId = DefineJIT.ddd.uniqueIdentifier();
  const ValidatedEmail = DefineJIT.ddd.valueObject(DefineJIT.string().email()).validate();
  const result = AOT.generate({
    groups: {},
    artifacts: { Email, UserId, ValidatedEmail },
    outDir,
  });
  const source = readFileSync(join(outDir, "index.js"), "utf8");
  const generated = (await import(pathToFileURL(join(outDir, "index.js")).href)) as {
    readonly Email: { create(input: string): { readonly value: string } };
    readonly UserId: { create(input?: string): { readonly value: string } };
    readonly ValidatedEmail: {
      create(input: string): { readonly value: string };
    };
  };

  expect(result.skipped).toEqual([]);
  expect(generated.Email.create("").value).toBe("");
  expect(generated.UserId.create().value).toMatch(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
  );
  expect(() => generated.ValidatedEmail.create("")).toThrow(/email/i);
  expect(source).not.toContain('from "@jit-compiler/jit"');
});

it("accepts an unambiguous DDD identity on the define host", () => {
  const UserId = DefineJIT.ddd.uniqueIdentifier(DefineJIT.string());
  const User = DefineJIT.ddd.entity(DefineJIT.object({ userId: UserId, name: DefineJIT.string() }));

  expect(User.schema.def.innerType.def.props.userId).toBe(UserId.schema);
  expect(User.schema.def.innerType.def.props.name).toBeDefined();
});

it("keeps validation opt-in in generated DDD factories", async () => {
  const schema = JIT.object({
    id: JIT.string(),
    email: JIT.string().email(),
    age: JIT.number().min(18),
  });
  const Unvalidated = JIT.ddd.entity(schema, { id: "id" });
  const Validated = Unvalidated.validate();
  const unvalidatedDir = mkdtempSync(join(tmpdir(), "jit-aot-unvalidated-"));
  const validatedDir = mkdtempSync(join(tmpdir(), "jit-aot-validated-"));

  try {
    const unvalidatedResult = AOT.generate({
      groups: {},
      artifacts: { Unvalidated },
      outDir: unvalidatedDir,
    });
    const validatedResult = AOT.generate({
      groups: {},
      artifacts: { Validated },
      outDir: validatedDir,
    });
    const unvalidatedSource = readFileSync(join(unvalidatedDir, "index.js"), "utf8");
    const validatedSource = readFileSync(join(validatedDir, "index.js"), "utf8");
    const unvalidated = (await import(pathToFileURL(join(unvalidatedDir, "index.js")).href)) as {
      readonly Unvalidated: { create(input: unknown): unknown };
    };
    const validated = (await import(pathToFileURL(join(validatedDir, "index.js")).href)) as {
      readonly Validated: { create(input: unknown): unknown };
    };
    const invalid = { id: "u_1", email: "", age: 1 };

    expect(unvalidatedResult.skipped).toEqual([]);
    expect(validatedResult.skipped).toEqual([]);
    expect(() => unvalidated.Unvalidated.create(invalid)).not.toThrow();
    expect(() => validated.Validated.create(invalid)).toThrow();
    expect(unvalidatedSource).not.toContain("invalid_format");
    expect(unvalidatedSource).not.toContain("too_small");
    expect(unvalidatedSource).not.toContain("JITValidationError");
    expect(validatedSource).toContain("invalid_format");
    expect(validatedSource).toContain("too_small");
    expect(validatedSource).toContain("ValidationError");
  } finally {
    rmSync(unvalidatedDir, { recursive: true, force: true });
    rmSync(validatedDir, { recursive: true, force: true });
  }
});

it("keeps domain-event definitions reconstructive on the define host", async () => {
  const OrderConfirmed = DefineJIT.ddd.domainEvent("order.confirmed", {
    version: 2,
    payload: DefineJIT.object({ orderId: DefineJIT.string() }),
  });
  const result = AOT.generate({
    groups: {},
    artifacts: { OrderConfirmed },
    outDir,
  });
  const generated = (await import(pathToFileURL(join(outDir, "index.js")).href)) as {
    readonly OrderConfirmed: {
      readonly type: "order.confirmed";
      readonly version: 2;
      create(input: { orderId: string }): {
        readonly type: "order.confirmed";
        readonly version: 2;
        readonly payload: { readonly orderId: string };
        readonly "~event": { readonly schemaVersion: 2 };
      };
    };
  };
  const event = generated.OrderConfirmed.create({ orderId: "o_1" });

  expect(result.skipped).toEqual([]);
  expect(generated.OrderConfirmed.type).toBe("order.confirmed");
  expect(generated.OrderConfirmed.version).toBe(2);
  expect(event.payload).toEqual({ orderId: "o_1" });
  expect(event["~event"]).toMatchObject({
    version: 1,
    type: "order.confirmed",
    schemaVersion: 2,
  });
});

it("preserves define-host assertions as reconstructive class metadata", async () => {
  const User = DefineJIT.ddd
    .entity(DefineJIT.object({ id: DefineJIT.string(), age: DefineJIT.number() }), { id: "id" })
    .assert((query) => query.gte("age", 18), { rule: "adult" });
  const result = AOT.generate({ groups: {}, artifacts: { User }, outDir });
  const generated = (await import(pathToFileURL(join(outDir, "index.js")).href)) as {
    readonly User: {
      create(input: unknown): { readonly id: string; readonly age: number };
    };
  };

  expect(result.skipped).toEqual([]);
  expect(generated.User.create({ id: "u_1", age: 18 })).toMatchObject({
    id: "u_1",
    age: 18,
  });
  expect(() => generated.User.create({ id: "u_1", age: 17 })).toThrow(/adult/);
});

it("preserves define-host member layout descriptors in AOT", async () => {
  const User = DefineJIT.ddd
    .entity(DefineJIT.object({ id: DefineJIT.string(), name: DefineJIT.string() }), {
      id: "id",
    })
    .extends({
      age: DefineJIT.class.public(DefineJIT.number()),
      cache: DefineJIT.class.noConstructor(DefineJIT.array(DefineJIT.string()).default([])),
    });
  const result = AOT.generate({ groups: {}, artifacts: { User }, outDir });
  const source = readFileSync(join(outDir, "index.js"), "utf8");
  const generated = (await import(pathToFileURL(join(outDir, "index.js")).href)) as {
    readonly User: {
      create(input: unknown): {
        readonly name: string;
        age: number;
        cache: string[];
      };
    };
  };

  expect(result.skipped).toEqual([]);
  const user = generated.User.create({ id: "u_1", name: "Ada", age: 37 });
  expect(user.cache).toEqual([]);
  user.age = 38;
  expect(user.age).toBe(38);
  expect(() => {
    (user as unknown as { name: string }).name = "Grace";
  }).toThrow(TypeError);
  expect(source).toContain('get ["name"]()');
  expect(source).toContain('get ["cache"]()');
});

it("inherits nested Runtime Type result modes on the define host", async () => {
  const TupleEmail = JIT.ddd.valueObject(JIT.string().email()).validate({ result: "tuple" });
  const User = DefineJIT.ddd.entity(DefineJIT.object({ id: DefineJIT.string(), email: TupleEmail }), { id: "id" });
  const result = AOT.generate({
    groups: {},
    artifacts: { TupleEmail, User },
    outDir,
  });
  expect(result.skipped).toEqual([]);
  const generated = (await import(pathToFileURL(join(outDir, "index.js")).href)) as {
    readonly User: {
      create(input: {
        readonly id: string;
        readonly email: string;
      }):
        | { readonly id: string; readonly email: string }
        | [Error | null, { readonly id: string; readonly email: string } | null];
    };
  };

  const created = generated.User.create({
    id: "u_1",
    email: "ada@example.com",
  });
  expect(Array.isArray(created)).toBe(true);
  if (Array.isArray(created)) expect(created[0]).toBeNull();
});

it("reports define-host custom factories as explicit AOT bindings", () => {
  const User = DefineJIT.class(DefineJIT.object({ id: DefineJIT.string() })).factories({
    create: DefineJIT.class.factory("make", () => undefined),
  });
  const result = AOT.generate({ groups: {}, artifacts: { User }, outDir });

  expect(result.skipped).toEqual([
    expect.objectContaining({
      schema: "User",
      operation: "class.factories",
      reason: expect.stringContaining("runtime binding"),
    }),
  ]);
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
  const publicUsers = createSecurityPipeline(JIT);
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

it("should serialize static collection update patches with their runtime semantics", async () => {
  const User = JIT.object({ id: JIT.number(), tags: JIT.array(JIT.string()) });
  const setPublicTags = JIT.from(JIT.array(User)).update({ tags: ["public"] });
  const result = AOT.generate({ groups: {}, artifacts: { setPublicTags }, outDir });
  const source = readFileSync(join(outDir, "index.js"), "utf8");
  const generated = (await import(pathToFileURL(join(outDir, "index.js")).href)) as {
    readonly setPublicTags: (users: readonly { id: number; tags: readonly string[] }[]) => {
      id: number;
      tags: readonly string[];
    }[];
  };

  expect(result.skipped).toHaveLength(0);
  expect(source).toContain('["public"]');
  expect(generated.setPublicTags([{ id: 1, tags: ["private"] }])).toEqual([{ id: 1, tags: ["public"] }]);
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
