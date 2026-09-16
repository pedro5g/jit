import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { AOT, JIT } from "../../index.js";
import { itWithOriginalFunctionSource, registerAotTestHooks, verifyGeneratedTypes } from "./aot-test-utils.js";

declare const AotTestEventBrand: unique symbol;
type AotTestEvent = { readonly [AotTestEventBrand]: true };

let outDir: string;
registerAotTestHooks((directory) => {
  outDir = directory;
});

it("should lower the clone capability through the shared clone plan", async () => {
  const Schema = JIT.object({
    id: JIT.string(),
    tags: JIT.array(JIT.string()),
  });
  const User = JIT.class(Schema).extends(JIT.class.clone);
  const result = AOT.generate({ groups: {}, artifacts: { User }, outDir });
  const source = readFileSync(join(outDir, "index.js"), "utf8");
  const generated = (await import(pathToFileURL(join(outDir, "index.js")).href)) as {
    readonly User: new (input: {
      id: string;
      tags: string[];
    }) => {
      readonly tags: string[];
      clone(): { readonly tags: string[] };
    };
  };
  const user = new generated.User({ id: "u_1", tags: ["a"] });
  const copy = user.clone();

  expect(result.skipped).toEqual([]);
  expect(source).not.toContain('from "@jit-compiler/jit"');
  expect(copy).toEqual(user);
  expect(copy).not.toBe(user);
  expect(copy.tags).not.toBe(user.tags);
});

it("should lower a factory result policy and its assertions", async () => {
  const MoneySchema = JIT.object({
    amount: JIT.number(),
    currency: JIT.enum(["BRL", "USD"]),
  });
  const Money = JIT.ddd
    .valueObject(MoneySchema)
    .validate({ result: "either" })
    .assert((query) => query.gte("amount", 0), { rule: "non-negative" });
  const result = AOT.generate({ groups: {}, artifacts: { Money }, outDir });
  const source = readFileSync(join(outDir, "index.js"), "utf8");
  const generated = (await import(pathToFileURL(join(outDir, "index.js")).href)) as {
    readonly Money: typeof Money;
  };

  expect(result.skipped).toEqual([]);
  expect(source).not.toContain('from "@jit-compiler/jit"');
  // The invariant is generated source, not a callback carried into the module.
  expect(source).toContain("value.amount >=");
  expect(source).toContain("class DomainAssertionError extends Error");
  expect(generated.Money.create({ amount: 10, currency: "BRL" })).toEqual(
    Money.create({ amount: 10, currency: "BRL" })
  );
  const rejected = generated.Money.create({ amount: -1, currency: "BRL" });
  expect(JIT.class.isFailure(rejected)).toBe(true);
  if (!JIT.class.isFailure(rejected)) throw new Error("expected assertion failure");
  expect((rejected.error as { readonly rule?: string }).rule).toBe("non-negative");
  // The generated module reports the same issues the runtime host does.
  expect(rejected.error?.issues).toEqual(
    (
      Money.create({ amount: -1, currency: "BRL" }) as {
        error: { issues: unknown };
      }
    ).error.issues
  );
  expect(JIT.class.isFailure(generated.Money.create({ amount: "x", currency: "BRL" } as never))).toBe(true);
  expect(JIT.class.isFailure(generated.Money.hydrate({ amount: -1, currency: "BRL" }))).toBe(true);
});

it("should skip a class whose configured error factory cannot be serialized", () => {
  const external = { label: "external" };
  const Money = JIT.ddd
    .valueObject(JIT.object({ amount: JIT.number() }))
    .validate({ result: "either", error: () => new Error(external.label) });
  const result = AOT.generate({ groups: {}, artifacts: { Money }, outDir });

  expect(result.skipped).toEqual([
    {
      schema: "Money",
      operation: "class.validate",
      reason: expect.stringContaining("error factory"),
    },
  ]);
});

it("should lower scalar value objects as standalone wrapper classes", async () => {
  const Email = JIT.ddd.valueObject(JIT.string().email());
  const result = AOT.generate({ groups: {}, artifacts: { Email }, outDir });
  const source = readFileSync(join(outDir, "index.js"), "utf8");
  const generated = (await import(pathToFileURL(join(outDir, "index.js")).href)) as {
    readonly Email: {
      create(input: string): {
        readonly value: string;
        equals(other: unknown): boolean;
        hashCode(): number;
      };
      hydrate(input: string): {
        readonly value: string;
        equals(other: unknown): boolean;
        hashCode(): number;
      };
    };
  };
  const email = generated.Email.create("ada@example.com");
  const restored = generated.Email.hydrate("ada@example.com");

  expect(result.skipped).toEqual([]);
  expect(email.value).toBe("ada@example.com");
  expect(email.equals(restored)).toBe(true);
  expect(email.hashCode()).toBe(restored.hashCode());
  expect(Object.isFrozen(email)).toBe(true);
  expect(JSON.stringify(email)).toBe('"ada@example.com"');
  expect(source).toContain("this.value = state;");
  expect(source).not.toContain('from "@jit-compiler/jit"');
});

it("lowers class clone and diff methods over nested Runtime Types", async () => {
  const UserId = JIT.ddd.uniqueIdentifier(JIT.string().uuid());
  const User = JIT.ddd
    .entity(JIT.object({ id: UserId, name: JIT.string() }), { id: "id" })
    .extends(JIT.class.clone(), JIT.class.diff());
  const result = AOT.generate({
    groups: {},
    artifacts: { UserId, User },
    outDir,
  });
  const source = readFileSync(join(outDir, "index.js"), "utf8");
  const generated = (await import(pathToFileURL(join(outDir, "index.js")).href)) as {
    readonly User: {
      create(input: { id: string; name: string }): {
        readonly id: { readonly value: string };
        readonly name: string;
        clone(): unknown;
        diff(other: unknown): readonly unknown[];
      };
    };
  };
  const user = generated.User.create({
    id: "7f8f4f83-f3c7-4bad-9b73-a3b70f47d761",
    name: "Ada",
  });
  const copy = user.clone() as typeof user;

  expect(result.skipped).toEqual([]);
  expect(copy).not.toBe(user);
  expect(copy.id).toBe(user.id);
  expect(user.diff(copy)).toEqual([]);
  expect(source).toContain("__jitMaterialize");
  expect(source).not.toContain("clone() { return new this.constructor");
});

itWithOriginalFunctionSource("should co-emit identifiers used by nested entity materialization", async () => {
  const UserId = JIT.ddd.uniqueIdentifier();
  const UserBase = JIT.ddd.entity(JIT.object({ id: UserId, name: JIT.string() }));
  const result = AOT.generate({
    groups: {},
    artifacts: { UserId, UserBase },
    outDir,
  });
  const generated = (await import(pathToFileURL(join(outDir, "index.js")).href)) as {
    readonly UserId: abstract new (input: string) => { readonly value: string };
    readonly UserBase: (abstract new (
      input: unknown
    ) => {
      id: { readonly value: string; equals(other: unknown): boolean };
      name: string;
      equals(other: unknown): boolean;
    }) & {
      create(input: { name: string }): {
        id: { readonly value: string; equals(other: unknown): boolean };
        name: string;
        equals(other: unknown): boolean;
      };
      hydrate(input: { id: string; name: string }): {
        id: { readonly value: string; equals(other: unknown): boolean };
        name: string;
        equals(other: unknown): boolean;
      };
    };
  };
  class User extends generated.UserBase {}
  const id = "7f8f4f83-f3c7-4bad-9b73-a3b70f47d761";
  const hydrated = User.hydrate({ id, name: "Ada" });
  const sameIdentity = User.hydrate({ id, name: "Grace" });

  expect(result.skipped).toEqual([]);
  expect(hydrated.id).toBeInstanceOf(generated.UserId);
  expect(hydrated.id.value).toBe(id);
  expect(hydrated.id.equals(sameIdentity.id)).toBe(true);
  expect("identity" in hydrated).toBe(false);
  expect("sameIdentity" in hydrated).toBe(false);
  expect(User.create({ name: "Ada" }).id).toBeInstanceOf(generated.UserId);
});

it("should preserve abstract value-object behavior in AOT subclasses", async () => {
  const MoneyBase = JIT.ddd.abstract.valueObject(
    JIT.object({
      amount: JIT.number(),
      currency: JIT.enum(["BRL", "USD"]),
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
  const User = JIT.class(JIT.object({ id: JIT.string().default("generated"), name: JIT.string() })).factories({
    create: "create",
    hydrate: "hydrate",
  });
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
  expect(() =>
    verifyGeneratedTypes(
      typedOutDir,
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
    )
  ).not.toThrow();
}, 30_000);

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
      new (input: {
        id: string;
        name: string;
      }): {
        id: string;
        name: string;
      };
    };
  };
  const user = new generated.User({ id: "u_1", name: "Ada" });

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
  expect(() =>
    verifyGeneratedTypes(
      typedOutDir,
      [
        'import { OrderConfirmed } from "./index.js";',
        'OrderConfirmed.create({ orderId: "o_1" });',
        "// @ts-expect-error payload fields are required",
        "OrderConfirmed.create({});",
        "",
      ].join("\n")
    )
  ).not.toThrow();
}, 30_000);

it("should preserve DDD capabilities and protected raise in typed AOT modules", () => {
  const Money = JIT.ddd.valueObject(JIT.object({ amount: JIT.number(), currency: JIT.string() }));
  const UserBase = JIT.ddd.entity(JIT.object({ id: JIT.string(), name: JIT.string() }), { id: "id" });
  const OrderBase = JIT.ddd.aggregateRoot(
    JIT.object({
      id: JIT.string().readonly(),
      status: JIT.enum(["draft", "confirmed"]),
    }),
    { id: "id" }
  );
  const typedOutDir = join(outDir, "typed-ddd");

  AOT.generate({
    artifacts: { Money, UserBase, OrderBase },
    outDir: typedOutDir,
    format: "ts",
  });
  expect(() =>
    verifyGeneratedTypes(
      typedOutDir,
      [
        'import { Money, OrderBase, UserBase } from "./index.js";',
        'Money.create({ amount: 10, currency: "BRL" }).equals(Money.create({ amount: 10, currency: "BRL" }));',
        "class User extends UserBase {}",
        'User.create({ id: "u_1", name: "Ada" }).equals(User.create({ id: "u_1", name: "Grace" }));',
        "class Order extends OrderBase {",
        '  confirm() { this._props.status = "confirmed"; }',
        "}",
        'const order = Order.create({ id: "o_1", status: "draft" });',
        "order.confirm();",
        "order.peekEvents();",
        "// @ts-expect-error raise is domain-internal",
        'order.raise({ type: "external" });',
        "// @ts-expect-error protected domain state is only available in subclasses",
        "order._props;",
        "",
      ].join("\n")
    )
  ).not.toThrow();
}, 30_000);

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
      status: JIT.enum(["draft", "confirmed"]),
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
  abstract class GeneratedOrderState {
    protected readonly _props!: {
      status: "draft" | "confirmed";
      shipping: { city: string; country: string };
    };
  }
  type OrderBaseConstructor = {
    new (
      state: unknown
    ): GeneratedOrderState & {
      raise(event: AotTestEvent): void;
      pullEvents(): AotTestEvent[];
      commit(publisher: { publish(event: AotTestEvent): void | PromiseLike<void> }): Promise<void>;
    };
    create(input: {
      status: "draft" | "confirmed";
      shipping: { city: string; country: string };
    }): GeneratedOrderState & {
      status: "draft" | "confirmed";
      shipping: { city: string; country: string };
    };
  };
  const generated = (await import(pathToFileURL(join(outDir, "index.js")).href)) as {
    readonly OrderBase: OrderBaseConstructor;
  };

  class Order extends generated.OrderBase {
    confirm() {
      this._props.status = "confirmed";
    }

    shipTo(city: string) {
      this._props.shipping = { ...this._props.shipping, city };
    }
  }

  const order = Order.create({
    status: "draft",
    shipping: { city: "Recife", country: "BR" },
  }) as unknown as Order;

  expect(result.skipped).toHaveLength(0);
  expect(source).toMatchSnapshot("AOT aggregate mutation and event buffer");
  order.confirm();
  expect(order.pullEvents()).toEqual([]);
  expect((order as Order & { status: string }).status).toBe("confirmed");
  expect((order as Order & { id: string }).id).toBe("o_1");
  expect(Object.keys(order)).toEqual([]);
  expect(Object.getOwnPropertyNames(order)).toEqual([]);
  order.shipTo("Sao Paulo");
  expect((order as Order & { shipping: { city: string; country: string } }).shipping).toEqual({
    city: "Sao Paulo",
    country: "BR",
  });
  await order.commit({ publish: () => undefined });
  expect(order.pullEvents()).toEqual([]);
});
