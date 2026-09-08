import { describe, expect, expectTypeOf, it } from "vitest";
import type * as ATS from "../../core/ats/index.js";
import type { SchemaInput } from "../../core/builder/index.js";
import { JITValidationError } from "../../errors/index.js";
import { JIT } from "../../index.js";

describe("Runtime Class V3 member definitions", () => {
  it("adds schema fields through extends and keeps the generated constructor direct", () => {
    const User = JIT.ddd.entity(JIT.object({ id: JIT.string(), name: JIT.string() }), { id: "id" }).extends({
      age: JIT.class.public(JIT.int().min(0)),
    });

    const user = User.create({ id: "u_1", name: "Ada", age: 37 });
    expect(user.age).toBe(37);
    expect(Object.keys(user)).toEqual([]);
    expect(Object.getOwnPropertyDescriptor(User.prototype, "age")?.get).toBeDefined();
    expect(() => {
      (user as unknown as Record<string, unknown>).age = 38;
    }).not.toThrow();
    expect(user.age).toBe(38);
  });

  it("uses a prototype getter and a gated internal setter for DDD defaults", () => {
    const User = JIT.ddd.entity(JIT.object({ id: JIT.string(), name: JIT.string() }), { id: "id" }).extends({
      rename(name: string) {
        this.name = name;
      },
    });
    const user = User.create({ id: "u_1", name: "Ada" });

    expect(user.name).toBe("Ada");
    expect(() => {
      (user as unknown as Record<string, unknown>).name = "public write";
    }).toThrow(TypeError);
    user.rename("Grace");
    expect(user.name).toBe("Grace");
  });

  it("composes canonical and custom accessors", () => {
    const User = JIT.class(
      JIT.object({ first: JIT.string(), last: JIT.string(), rawScore: JIT.int(), score: JIT.int() })
    ).extends({
      fullName: JIT.class.public(
        JIT.class.getter(function (this: { first: string; last: string }) {
          return `${this.first} ${this.last}`;
        })
      ),
      score: JIT.class.override(
        JIT.class.public(
          JIT.class.getter(function (this: { rawScore: number }) {
            return this.rawScore;
          }),
          JIT.class.setter(function (this: { rawScore: number }, value: number) {
            this.rawScore = value;
          })
        )
      ),
    });
    const user = new User({ first: "Ada", last: "Lovelace", rawScore: 10, score: 0 });

    expect(user.fullName).toBe("Ada Lovelace");
    user.score = 11;
    expect(user.score).toBe(11);
  });

  it("uses the canonical override marker to replace a resolved member", () => {
    const Base = JIT.class(JIT.object({ name: JIT.string() })).extends({
      greeting() {
        return `Hello ${this.name}`;
      },
    });
    const User = Base.extends({
      greeting: JIT.class.override(function (this: { name: string }) {
        return `Hi ${this.name}`;
      }),
    });

    expect(new User({ name: "Ada" }).greeting()).toBe("Hi Ada");
  });

  it("validates a declared method contract once and installs it directly", () => {
    const Rename = JIT.class.method({ input: [JIT.string()], output: JIT.void() });
    const User = JIT.ddd.entity(JIT.object({ id: JIT.string(), name: JIT.string() }), { id: "id" }).extends({
      rename: Rename.implement(function (this: { name: string }, name: string) {
        this.name = name;
      }),
    });
    const user = User.create({ id: "u_1", name: "Ada" });

    user.rename("Grace");
    expect(user.name).toBe("Grace");
    expect(() => (user.rename as unknown as (...args: unknown[]) => unknown)(1)).toThrow();
    expectTypeOf(user.rename).toEqualTypeOf<(name: string) => void>();
  });

  it("supports explicit custom factories without reopening direct construction", () => {
    const User = JIT.class(JIT.object({ id: JIT.string(), name: JIT.string() })).factories({
      create: JIT.class.factory("make", function (data: { id: string; name: string }, ctx) {
        return ctx.construct({ ...data, name: data.name.toUpperCase() });
      }),
      hydrate: JIT.class.factory(
        "restore",
        function (data: { id: string; name: string }, ctx) {
          return ctx.construct(data);
        },
        "hydrate"
      ),
    });

    expect(User.make({ id: "u_1", name: "Ada" }).name).toBe("ADA");
    expect(User.restore({ id: "u_1", name: "Ada" }).name).toBe("Ada");
    expect(() => new (User as unknown as new (input: unknown) => unknown)({ id: "u_1", name: "Ada" })).toThrow(
      /factory construction/i
    );
  });

  it("runs class assertions before custom factory callbacks", () => {
    const User = JIT.ddd
      .entity(JIT.object({ id: JIT.string(), age: JIT.number() }), { id: "id" })
      .factories({
        create: JIT.class.factory("make", function (data: { id: string; age: number }, context) {
          return context.construct(data);
        }),
      })
      .assert((query) => query.gte("age", 0));

    expect(() => User.make({ id: "u_1", age: -1 })).toThrow(/assertion/i);
    expect(User.make({ id: "u_2", age: 1 }).age).toBe(1);
  });

  it("keeps no-constructor fields transient and initializes them from their compiled default", () => {
    const User = JIT.ddd.entity(JIT.object({ id: JIT.string() }), { id: "id" }).extends({
      cache: JIT.class.noConstructor(JIT.array(JIT.string()).default(() => [])),
    });

    const created = User.create({ id: "u_1" });
    const hydrated = User.hydrate({ id: "u_2" });
    expect(created.cache).toEqual([]);
    expect(hydrated.cache).toEqual([]);
    expect(created.cache).not.toBe(hydrated.cache);
    expect(Object.keys(created)).toEqual([]);
    expect(User.create({ id: "u_1", cache: ["caller-supplied"] } as unknown as { readonly id: string }).cache).toEqual(
      []
    );
    expect(JIT.json.stringify(User)(created)).toBe('{"id":"u_1"}');
    const Plain = JIT.class(JIT.object({ id: JIT.string() })).extends({
      cache: JIT.class.noConstructor(JIT.array(JIT.string()).default(() => [])),
    });
    expect(new Plain({ id: "u_3", cache: ["caller-supplied"] } as never).cache).toEqual([]);
    expectTypeOf<JIT.Wire<typeof User>>().toEqualTypeOf<{ id: string }>();
    if (Object.is(1, 2)) {
      // @ts-expect-error generated fields are outside every input boundary
      User.create({ id: "u_4", cache: new Map() });
    }
  });

  it("keeps protected and private-like members off the public type while preserving internal access", () => {
    const Account = JIT.class(JIT.object({ id: JIT.string() })).extends({
      secret: JIT.class.private(JIT.string()),
      balance: JIT.class.protected(JIT.number()),
      reveal() {
        return `${this.secret}:${this.balance}`;
      },
      credit(amount: number) {
        this.balance = this.balance + amount;
      },
    });
    const account = new Account({ id: "a_1", secret: "token", balance: 10 });
    expect(account.reveal()).toBe("token:10");
    account.credit(2);
    expect(account.reveal()).toBe("token:12");
    if (Object.is(1, 2)) {
      // @ts-expect-error private-like members are not public
      account.secret;
      // @ts-expect-error protected-like members are not public
      account.balance;
    }
  });

  it("fuses nested Runtime Type assertions into the outer validation boundary", () => {
    const Money = JIT.ddd.valueObject(JIT.object({ amount: JIT.number() })).assert((query) => query.gte("amount", 0));
    const Order = JIT.ddd
      .entity(JIT.object({ id: JIT.string(), total: Money }), { id: "id" })
      .validate({ result: "either" });

    const invalid = Order.create({ id: "o_1", total: { amount: -1 } });
    expect(JIT.class.isFailure(invalid)).toBe(true);
    if (JIT.class.isFailure(invalid)) {
      expect(invalid.error.issues[0]?.path).toEqual(["total", "amount"]);
      expect(invalid.error.issues[0]?.code).toBe("custom");
    }
    const valid = Order.create({ id: "o_2", total: { amount: 10 } });
    expect(JIT.class.isFailure(valid)).toBe(false);
    if (!JIT.class.isFailure(valid)) expect(valid.total.amount).toBe(10);
  });

  it("selects a nested assertion error after collecting the outer issues", () => {
    class NestedAssertionError extends Error {}
    class OuterError extends Error {}
    const Money = JIT.ddd.valueObject(JIT.object({ amount: JIT.number() })).assert((query) => query.gte("amount", 0), {
      priority: 1200,
      error: () => new NestedAssertionError("negative amount"),
    });
    const Order = JIT.ddd
      .entity(JIT.object({ id: JIT.string(), total: Money }), { id: "id" })
      .validate({ result: "either", error: () => new OuterError("invalid order") });

    const rejected = Order.create({ id: "o_1", total: { amount: -1 } });
    expect(JIT.class.isFailure(rejected)).toBe(true);
    if (JIT.class.isFailure(rejected)) expect(rejected.error).toBeInstanceOf(NestedAssertionError);
  });

  it("resolves mixed nested result modes by priority and safety rank", () => {
    const TupleEmail = JIT.ddd.valueObject(JIT.string().email()).validate({ result: "tuple", priority: 700 });
    const ResultEmail = JIT.ddd.valueObject(JIT.string().email()).validate({ result: "either", priority: 800 });
    const User = JIT.ddd.entity(JIT.object({ id: JIT.string(), email: TupleEmail, backupEmail: ResultEmail }), {
      id: "id",
    });

    const rejected = User.create({ id: "u_1", email: "bad", backupEmail: "bad" });
    expect(JIT.class.isFailure(rejected)).toBe(true);
    if (JIT.class.isFailure(rejected)) expect(rejected.error).toBeInstanceOf(JITValidationError);

    const Configured = User.validate({ result: "tuple" });
    const tupleRejected = Configured.create({ id: "u_2", email: "bad", backupEmail: "bad" });
    expect(tupleRejected[0]).toBeInstanceOf(JITValidationError);
    expect(tupleRejected[1]).toBeNull();
  });

  it("resolves every nested policy matrix identically at runtime and in types", () => {
    const parent = <TLeft extends SchemaInput<ATS.AnyTypeSchema>, TRight extends SchemaInput<ATS.AnyTypeSchema>>(
      left: TLeft,
      right: TRight
    ) => JIT.ddd.entity(JIT.object({ id: JIT.string(), left, right }), { id: "id" });
    const mode = (value: unknown): string =>
      (
        value as {
          readonly schema: {
            readonly def: { readonly traits: { readonly factoryPolicy: { readonly resultMode: string } } };
          };
        }
      ).schema.def.traits.factoryPolicy.resultMode;
    const tuple700 = JIT.ddd.valueObject(JIT.string()).validate({ result: "tuple", priority: 700 });
    const tuple800 = JIT.ddd.valueObject(JIT.string()).validate({ result: "tuple", priority: 800 });
    const tuple900 = JIT.ddd.valueObject(JIT.string()).validate({ result: "tuple", priority: 900 });
    const tuple1500 = JIT.ddd.valueObject(JIT.string()).validate({ result: "tuple", priority: 1500 });
    const either800 = JIT.ddd.valueObject(JIT.string()).validate({ result: "either", priority: 800 });
    const either900 = JIT.ddd.valueObject(JIT.string()).validate({ result: "either", priority: 900 });
    const either1000 = JIT.ddd.valueObject(JIT.string()).validate({ result: "either", priority: 1000 });
    const throw700 = JIT.ddd.valueObject(JIT.string()).validate({ result: "throw", priority: 700 });
    const throw800 = JIT.ddd.valueObject(JIT.string()).validate({ result: "throw", priority: 800 });
    const throw900 = JIT.ddd.valueObject(JIT.string()).validate({ result: "throw", priority: 900 });

    expect(mode(parent(tuple700, either800))).toBe("either");
    expect(mode(parent(tuple900, either800))).toBe("tuple");
    expect(mode(parent(throw900, either800))).toBe("throw");
    expect(mode(parent(throw700, either900))).toBe("either");
    expect(mode(parent(tuple800, either800))).toBe("either");
    expect(mode(parent(tuple800, throw800))).toBe("throw");
    expect(mode(parent(either800, throw800))).toBe("throw");
    expect(mode(parent(tuple1500, either1000))).toBe("tuple");

    const inheritedEither = parent(tuple700, either800);
    const eitherResult = inheritedEither.create({ id: "u_1", left: "a", right: "b" });
    if (!JIT.class.isFailure(eitherResult)) expectTypeOf(eitherResult.id).toEqualTypeOf<string>();

    const inheritedTuple = parent(tuple900, either800);
    const tupleResult = inheritedTuple.create({ id: "u_2", left: "a", right: "b" });
    expectTypeOf(tupleResult).toHaveProperty(0);

    const inheritedThrow = parent(throw900, either800);
    const throwResult = inheritedThrow.create({ id: "u_3", left: "a", right: "b" });
    expectTypeOf(throwResult).toHaveProperty("id");

    const rootTuple = inheritedEither.validate({ result: "tuple" });
    expectTypeOf(rootTuple.create({ id: "u_4", left: "a", right: "b" })).toHaveProperty(0);
  });

  it("provides immutable custom mixins through an extended DDD namespace", () => {
    const DDD = JIT.ddd.$extends({
      auditable: () =>
        JIT.class.mixin({
          fields: { createdBy: JIT.string() },
        }),
    });
    const User = DDD.entity(JIT.object({ id: JIT.string(), name: JIT.string() }), { id: "id" }).extends(
      DDD.auditable()
    );
    const user = User.create({ id: "u_1", name: "Ada", createdBy: "system" });
    expect(user.createdBy).toBe("system");
    expect(DDD).not.toBe(JIT.ddd);
    expect((JIT.ddd as unknown as { auditable?: unknown }).auditable).toBe(DDD.auditable);
  });

  it("types mixin methods from their fields and requirements and resolves identity structurally", () => {
    const UUID = JIT.ddd.uniqueIdentifier(
      JIT.string()
        .uuid()
        .default(() => "550e8400-e29b-41d4-a716-446655440000")
    );
    const UUIDMixin = JIT.class.mixin({
      fields: { id: UUID },
      methods: {
        getId() {
          return this.id;
        },
      },
    });
    const User = JIT.ddd.entity(JIT.object({ name: JIT.string() })).extends(UUIDMixin);
    const user = User.create({ name: "Ada" });
    expect(user.getId()).toBe(user.id);
    expectTypeOf(user.getId()).toEqualTypeOf(user.id);

    const Sluggable = JIT.class.mixin({
      requires: { name: JIT.string() },
      fields: { slug: JIT.string() },
      methods: {
        refreshSlug() {
          return this.name.toLowerCase();
        },
      },
    });
    const SluggableUser = JIT.class(JIT.object({ name: JIT.string() })).extends(Sluggable);
    expect(new SluggableUser({ name: "Ada", slug: "ada" }).refreshSlug()).toBe("ada");
    const applySluggable = (value: unknown) =>
      (value as { extends(mixin: typeof Sluggable): unknown }).extends(Sluggable);
    expect(() => applySluggable(JIT.class(JIT.object({ title: JIT.string() })))).toThrow(
      expect.objectContaining({ code: "CLASS_FIELD_DESCRIPTOR_CONFLICT" })
    );
    if (Object.is(1, 2)) {
      // @ts-expect-error a mixin requirement must exist on the host schema
      JIT.class(JIT.object({ title: JIT.string() })).extends(Sluggable);
    }
  });

  it("rejects a mixin that declares one name as both field and method", () => {
    expect(() =>
      JIT.class.mixin({
        fields: { audit: JIT.string() },
        methods: { audit() {} },
      })
    ).toThrow(expect.objectContaining({ code: "CLASS_MEMBER_ALREADY_EXISTS" }));
  });

  it("resolves scalar Runtime Type extensions through the shared member descriptors", () => {
    const UserId = JIT.ddd
      .uniqueIdentifier(JIT.string().uuid())
      .extends({
        text() {
          return this.value;
        },
      })
      .extends({
        text: JIT.class.override(function (this: { value: string }) {
          return this.value.toUpperCase();
        }),
      })
      .validate({ result: "either" });

    const result = UserId.create("550e8400-e29b-41d4-a716-446655440000");
    expect(JIT.class.isFailure(result)).toBe(false);
    if (!JIT.class.isFailure(result)) expect(result.text()).toBe("550E8400-E29B-41D4-A716-446655440000");
  });

  it("supports schema-backed accessors and subclassing", () => {
    const UserBase = JIT.ddd
      .entity(JIT.object({ id: JIT.string(), name: JIT.string() }), { id: "id" })
      .extends({
        email: JIT.class.private(JIT.class.getter(JIT.string().email()), JIT.class.setter()),
      })
      .extends({
        setEmail(value: string) {
          this.email = value;
          return this.email;
        },
      });
    class UserEntity extends UserBase {}

    const user = UserEntity.create({ id: "u_1", name: "Ada", email: "ada@example.com" });
    expect(user.setEmail("grace@example.com")).toBe("grace@example.com");
    expectTypeOf(user.setEmail).toEqualTypeOf<(value: string) => string>();
  });

  it("adds a layout-independent class JSON capability", () => {
    const UserBase = JIT.ddd
      .entity(JIT.object({ id: JIT.string(), name: JIT.string(), tags: JIT.array(JIT.string()) }), { id: "id" })
      .extends(JIT.class.json());
    class UserEntity extends UserBase {}

    const user = UserEntity.create({ id: "u_1", name: "Ada", tags: ["admin"] });
    expect(user.toJson()).toBe('{"id":"u_1","name":"Ada","tags":["admin"]}');
    expectTypeOf(user.toJson()).toEqualTypeOf<string>();
  });
});
