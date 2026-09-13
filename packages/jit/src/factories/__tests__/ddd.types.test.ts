import { expect, expectTypeOf, it } from "vitest";
import { JIT } from "../../index.js";

it("preserves Runtime Type identity traits through fluent configuration", () => {
  const UUID = JIT.ddd
    .uniqueIdentifier(
      JIT.string()
        .uuid()
        .default(() => crypto.randomUUID())
    )
    .validate({ result: "tuple" });

  const UserSchema = JIT.object({
    id: UUID,
    name: JIT.string(),
  });

  const User = JIT.ddd.entity(UserSchema);
  const [userError, user] = User.create({ name: "Ada" });

  expect(userError).toBeNull();
  if (user === null) throw new Error("unexpected user creation failure");
  expect(user.id.value).toMatch(/^[0-9a-f-]{36}$/i);
  expectTypeOf(user.id.value).toEqualTypeOf<string>();

  const validateThenFactories = JIT.ddd
    .uniqueIdentifier(
      JIT.string()
        .uuid()
        .default(() => crypto.randomUUID())
    )
    .validate({ result: "either" })
    .factories({ create: "make" });
  const factoriesThenValidate = JIT.ddd
    .uniqueIdentifier(
      JIT.string()
        .uuid()
        .default(() => crypto.randomUUID())
    )
    .factories({ create: "make" })
    .validate({ result: "either" });
  const extended = JIT.ddd
    .uniqueIdentifier(
      JIT.string()
        .uuid()
        .default(() => crypto.randomUUID())
    )
    .extends({
      label() {
        return this.value;
      },
    })
    .validate({ result: "either" });

  const first = JIT.ddd.entity(JIT.object({ id: validateThenFactories, name: JIT.string() }));
  const second = JIT.ddd.entity(JIT.object({ id: factoriesThenValidate, name: JIT.string() }));
  const third = JIT.ddd.entity(JIT.object({ id: extended, name: JIT.string() }));

  const firstResult = first.create({ name: "Ada" });
  const secondResult = second.create({ name: "Ada" });
  const thirdResult = third.create({ name: "Ada" });
  if (!JIT.class.isFailure(firstResult)) expectTypeOf(firstResult.id.value).toEqualTypeOf<string>();
  if (!JIT.class.isFailure(secondResult)) expectTypeOf(secondResult.id.value).toEqualTypeOf<string>();
  if (!JIT.class.isFailure(thirdResult)) expectTypeOf(thirdResult.id.value).toEqualTypeOf<string>();
  if (!JIT.class.isFailure(firstResult)) expect(firstResult.id.value).toMatch(/^[0-9a-f-]{36}$/i);

  const Audited = JIT.ddd
    .entity(JIT.object({ id: UUID, name: JIT.string() }))
    .extends(JIT.ddd.timestamps(), JIT.ddd.softDelete(), JIT.ddd.versioned());
  const createdAt = new Date("2026-01-01T00:00:00.000Z");
  const [suppliedError, supplied] = Audited.create({
    name: "Ada",
    createdAt,
    updatedAt: null,
    deletedAt: null,
    version: 4,
  });
  expect(suppliedError).toBeNull();
  if (supplied === null) throw new Error("unexpected audited creation failure");
  expect(supplied.createdAt).toBe(createdAt);
  expect(supplied.version).toBe(4);
  const [hydrateError, hydrated] = Audited.hydrate({ id: "not-a-uuid", name: "Ada" } as never);
  expect(hydrateError).not.toBeNull();
  expect(hydrated).toBeNull();
});

it("rejects ambiguous inferred identity at declaration time", () => {
  const UserId = JIT.ddd.uniqueIdentifier(JIT.string().uuid());
  const Schema = JIT.object({ userId: UserId, tenantId: UserId });

  expect(() => (JIT.ddd.entity as (schema: typeof Schema) => unknown)(Schema)).toThrow(/multiple unique identifiers/i);
});

it("exposes DDD fields as readonly while keeping internal extension this mutable", () => {
  const UserBase = JIT.ddd.entity(JIT.object({ id: JIT.string(), name: JIT.string(), age: JIT.number() }), {
    id: "id",
  });
  class User extends UserBase {
    rename(name: string) {
      this._props.name = name;
      this._props.age = this._props.age + 1;
    }
  }
  const user = User.create({ id: "u_1", name: "Ada", age: 36 });
  user.rename("Grace");
  expectTypeOf(user.name).toEqualTypeOf<string>();
  expectTypeOf(user.age).toEqualTypeOf<number>();
  if (Object.is(1, 2)) {
    // @ts-expect-error DDD public fields are readonly
    user.name = "Nope";
    // @ts-expect-error fields added through extends() are readonly too
    user.age = 40;
  }
});

it("keeps explicitly public DDD fields writable in the public surface", () => {
  const User = JIT.ddd.entity(JIT.object({ id: JIT.string() }), { id: "id" }).extends({
    age: JIT.class.public(JIT.number()),
  });
  const user = User.create({ id: "u_1", age: 36 });
  user.age = 37;
  expect(user.age).toBe(37);

  const Reconfigured = User.extends({ age: JIT.class.override(JIT.number()) });
  const reconfigured = Reconfigured.create({ id: "u_2", age: 38 });
  reconfigured.age = 39;
  expect(reconfigured.age).toBe(39);
});

it("preserves accessor types across composed member descriptors", () => {
  const User = JIT.ddd.entity(JIT.object({ id: JIT.string(), raw: JIT.number() }), { id: "id" }).extends({
    display: JIT.class.public(
      JIT.class.getter(function (this: { raw: number }) {
        return String(this.raw);
      })
    ),
    score: JIT.class.public(JIT.number(), JIT.class.getter(), JIT.class.setter()),
  });
  const user = User.create({ id: "u_1", raw: 10, score: 10 });
  expectTypeOf(user.display).toEqualTypeOf<string>();
  user.score = 11;
  expect(user.display).toBe("10");
});

it("folds extension this types in declaration order", () => {
  const User = JIT.class(JIT.object({ id: JIT.string() })).extends(
    {
      first() {
        return this.id;
      },
    },
    {
      second() {
        return this.first();
      },
    }
  );

  expectTypeOf(new User({ id: "u_1" }).second()).toEqualTypeOf<string>();
  if (Object.is(1, 2)) {
    JIT.class(JIT.object({ id: JIT.string() })).extends(
      {
        second() {
          // @ts-expect-error a later extension is not in this prefix
          return this.first();
        },
      },
      { first() {} }
    );
  }
});

it("supports an explicit this fallback for override function expressions", () => {
  const Base = JIT.class(JIT.object({ updatedAt: JIT.date() })).extends({
    touch() {
      this.updatedAt = new Date();
    },
  });
  type BaseInstance = InstanceType<typeof Base>;
  if (Object.is(1, 2)) {
    Base.extends({
      touch: JIT.class.override<BaseInstance>(function () {
        this.updatedAt = new Date();
      }),
    });
  }
});

it("resolves mixed nested factory result modes by priority and type-level rank", () => {
  const TupleEmail = JIT.ddd.valueObject(JIT.string().email()).validate({ result: "tuple" });
  const ResultEmail = JIT.ddd.valueObject(JIT.string().email()).validate({ result: "either" });
  const User = JIT.ddd.entity(JIT.object({ id: JIT.string(), email: TupleEmail, backupEmail: ResultEmail }), {
    id: "id",
  });

  const inherited = User.create({ id: "u_1", email: "ada@example.com", backupEmail: "ada@example.com" });
  if (!JIT.class.isFailure(inherited)) expectTypeOf(inherited.id).toEqualTypeOf<string>();

  const Configured = User.validate({ result: "either" });
  const created = Configured.create({ id: "u_2", email: "ada@example.com", backupEmail: "ada@example.com" });
  if (!JIT.class.isFailure(created)) expectTypeOf(created.id).toEqualTypeOf<string>();
});

it("propagates an inherited nested result mode through multiple Runtime Type levels", () => {
  const Leaf = JIT.ddd.valueObject(JIT.string().email()).validate({ result: "tuple" });
  const Middle = JIT.ddd.entity(JIT.object({ id: JIT.string(), leaf: Leaf }), { id: "id" });
  const Outer = JIT.ddd.entity(JIT.object({ id: JIT.string(), middle: Middle }), { id: "id" });

  const [error, value] = Outer.create({ id: "outer", middle: { id: "middle", leaf: "ada@example.com" } });
  expect(error).toBeNull();
  if (value === null) throw new Error("unexpected nested entity creation failure");
  expect(value.middle.leaf.value).toBe("ada@example.com");
  expectTypeOf(value.middle.leaf.value).toEqualTypeOf<string>();
});
