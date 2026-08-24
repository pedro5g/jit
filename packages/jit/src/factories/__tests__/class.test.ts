import { JIT } from "../../index.js";

describe("JIT.class", () => {
  const UserSchema = JIT.object({
    id: JIT.string().default("generated"),
    name: JIT.string().min(2),
    createdAt: JIT.date().default(() => new Date(0)),
  });

  it("constructs instances in schema-field order after compiled validation", () => {
    const User = JIT.class(UserSchema);
    const user = User.create({ name: "Ada" });

    expect(user).toBeInstanceOf(User);
    expect(user).toEqual({
      id: "generated",
      name: "Ada",
      createdAt: new Date(0),
    });
    expect(Object.keys(user)).toEqual(["id", "name", "createdAt"]);
    expect(User.schema).toBe(UserSchema.schema);
    expectTypeOf(user).toEqualTypeOf<JIT.Typeof<typeof UserSchema>>();
  });

  it("hydrates validated state without applying a distinct construction path", () => {
    const User = JIT.class(UserSchema);
    const state = { id: "u_1", name: "Grace", createdAt: new Date(1) };

    expect(User.hydrate(state)).toBeInstanceOf(User);
    expect(JIT.parse(User)(state)).toBeInstanceOf(User);
    expect(JIT.safeParse(User)(state)).toMatchObject({
      success: true,
      data: expect.any(User),
    });
    expectTypeOf(JIT.parse(User)).toMatchTypeOf<(value: unknown) => InstanceType<typeof User>>();
    expect(() => User.hydrate({ ...state, name: "x" })).toThrow(/at least 2 characters/i);
  });

  it("preserves polymorphic static construction for subclasses", () => {
    const UserBase = JIT.class.abstract(UserSchema);

    class User extends UserBase {
      greeting() {
        return `Hello ${this.name}`;
      }
    }

    const user = User.create({ name: "Ada" });

    expect(user).toBeInstanceOf(User);
    expect(user.greeting()).toBe("Hello Ada");
    expect(() => UserBase.create({ name: "Ada" })).toThrow(/abstract JIT class/i);
    expectTypeOf(user).toEqualTypeOf<User>();
  });

  it("rejects non-object schemas before emitting a constructor", () => {
    expect(() => JIT.class(JIT.string())).toThrow(/object schema/i);
  });

  it("adds structural capabilities through immutable descriptors on the prototype", () => {
    const User = JIT.class(UserSchema).use(
      JIT.class.equals,
      JIT.class.hashCode,
      JIT.class.diff,
      JIT.class.identity("id")
    );
    const ada = User.create({ name: "Ada" });
    const same = User.create({ name: "Ada" });
    const grace = User.create({ name: "Grace" });

    expect(ada.equals(same)).toBe(true);
    expect(ada.hashCode()).toBe(same.hashCode());
    expect(ada.sameIdentity(same)).toBe(true);
    expect(ada.identity()).toBe("generated");
    expect(ada.diff(grace)).toEqual([{ type: "update", path: ["name"], value: "Grace" }]);
  });

  it("uses the compiled immutable update while preserving readonly fields", () => {
    const User = JIT.class(
      JIT.object({
        id: JIT.string().readonly(),
        name: JIT.string(),
        profile: JIT.object({ label: JIT.string() }),
      })
    ).use(JIT.class.with);
    const ada = User.create({
      id: "u_1",
      name: "Ada",
      profile: { label: "math" },
    });
    const next = ada.with({ name: "Grace", profile: { label: "compiler" } });

    expect(next).toBeInstanceOf(User);
    expect(next).toEqual({
      id: "u_1",
      name: "Grace",
      profile: { label: "compiler" },
    });
    expect(ada).toEqual({ id: "u_1", name: "Ada", profile: { label: "math" } });
    // @ts-expect-error readonly state cannot be patched through .with()
    ada.with({ id: "u_2" });
  });

  it("builds frozen value objects from the same class capabilities", () => {
    const Money = JIT.valueObject(
      JIT.object({
        amount: JIT.number(),
        currency: JIT.enum(["BRL", "USD"] as const),
      })
    );
    const money = Money.create({ amount: 10, currency: "BRL" });

    expect(Object.isFrozen(money)).toBe(true);
    expect(money.equals(Money.create({ amount: 10, currency: "BRL" }))).toBe(true);
    expect(money.hashCode()).toBe(Money.create({ amount: 10, currency: "BRL" }).hashCode());
  });

  it("builds abstract entities with identity separate from structural equality", () => {
    const UserBase = JIT.entity(JIT.object({ id: JIT.string(), name: JIT.string() }), { id: "id" });

    class User extends UserBase {}

    expect(User.create({ id: "u_1", name: "Ada" }).sameIdentity(User.create({ id: "u_1", name: "Grace" }))).toBe(true);
    expect(() => UserBase.create({ id: "u_1", name: "Ada" })).toThrow(/abstract JIT class/i);
  });

  it("keeps aggregate events ordered and applies updates through static assignments", () => {
    const OrderBase = JIT.aggregateRoot(
      JIT.object({
        id: JIT.string().readonly(),
        status: JIT.enum(["draft", "confirmed"] as const),
      }),
      { id: "id" }
    );
    class Order extends OrderBase {
      confirm() {
        this.update({ status: "confirmed" });
        this.raise({ type: "order.confirmed" });
      }
    }

    const order = Order.create({ id: "o_1", status: "draft" });
    order.confirm();
    order.raise({ type: "order.notified" });

    expect(order.status).toBe("confirmed");
    expect(order.peekEvents()).toEqual([{ type: "order.confirmed" }, { type: "order.notified" }]);
    expect(order.pullEvents()).toEqual([{ type: "order.confirmed" }, { type: "order.notified" }]);
    expect(order.peekEvents()).toEqual([]);
    // @ts-expect-error aggregate updates preserve readonly identity fields
    order.update({ id: "o_2" });
  });

  it("creates immutable, versioned domain events from payload input", () => {
    const OrderConfirmed = JIT.domainEvent("order.confirmed", {
      version: 1,
      payload: JIT.object({ orderId: JIT.string().min(1) }),
    });
    const event = OrderConfirmed.create({ orderId: "o_1" });

    expect(event).toBeInstanceOf(OrderConfirmed);
    expect(Object.isFrozen(event)).toBe(true);
    expect(event).toMatchObject({
      type: "order.confirmed",
      version: 1,
      payload: { orderId: "o_1" },
    });
    expect(event.id).toEqual(expect.any(String));
    expect(event.occurredAt).toBeInstanceOf(Date);
    expect(JIT.parse(OrderConfirmed)(event)).toBeInstanceOf(OrderConfirmed);
  });
});
