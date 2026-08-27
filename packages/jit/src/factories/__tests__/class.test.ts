import { JIT } from "../../index.js";

describe("JIT.class", () => {
  const UserSchema = JIT.object({
    id: JIT.string().default("generated"),
    name: JIT.string().min(2),
    createdAt: JIT.date().default(() => new Date(0)),
  });

  it("exposes DDD presets at the top level with canonical factories", () => {
    const User = JIT.ddd.entity(JIT.object({ id: JIT.string() }), { id: "id" });
    const Order = JIT.ddd.aggregateRoot(JIT.object({ id: JIT.string() }), { id: "id" });
    const Registered = JIT.ddd.domainEvent("user.registered", {
      payload: JIT.object({ id: JIT.string() }),
      version: 1,
    });

    class ConcreteUser extends User {}

    expect(ConcreteUser.create({ id: "u_1" })).toBeInstanceOf(ConcreteUser);
    expect(Order.schema).toBeDefined();
    expect(Registered.create({ id: "u_1" }).type).toBe("user.registered");
    expect("new" in Registered).toBe(false);
  });

  it("constructs instances in schema-field order after compiled validation", () => {
    const User = JIT.class(UserSchema);
    const user = User.create({ name: "Ada" });
    const constructed = new User({ name: "Ada" });

    expect(user).toBeInstanceOf(User);
    expect(user).toEqual({
      id: "generated",
      name: "Ada",
      createdAt: new Date(0),
    });
    expect(Object.keys(user)).toEqual(["id", "name", "createdAt"]);
    expect(constructed).toEqual(user);
    expect(() => new User({ name: "x" })).toThrow(/at least 2 characters/i);
    expect(User.schema.def.innerType).toBe(UserSchema.schema);
    expectTypeOf(user).toEqualTypeOf<JIT.Typeof<typeof User>>();
    expectTypeOf<JIT.Hydrate<typeof User>>().toEqualTypeOf<JIT.Typeof<typeof UserSchema>>();
    expectTypeOf<JIT.Wire<typeof User>>().toEqualTypeOf<JIT.Typeof<typeof UserSchema>>();
  });

  it("materializes nested runtime classes through the compiled validator", () => {
    const Address = JIT.class(JIT.object({ city: JIT.string() }));
    const User = JIT.class(JIT.object({ name: JIT.string(), address: Address, addresses: JIT.array(Address) }));
    const user = User.create({
      name: "Ada",
      address: { city: "London" },
      addresses: [{ city: "London" }, { city: "Paris" }],
    });

    expect(user.address).toBeInstanceOf(Address);
    expect(user.addresses[0]).toBeInstanceOf(Address);
    expect(user.addresses[1]).toBeInstanceOf(Address);
    expectTypeOf(user.address).toEqualTypeOf<JIT.Typeof<typeof Address>>();
  });

  it("serializes runtime classes through their stable inner wire schema", () => {
    const Address = JIT.class(JIT.object({ city: JIT.string() }));
    const User = JIT.class(JIT.object({ name: JIT.string(), address: Address }));
    const user = User.create({ name: "Ada", address: { city: "London" } });

    expect(JIT.json.stringify(User)(user)).toBe('{"name":"Ada","address":{"city":"London"}}');
    expect(JIT.json.stringify(JIT.array(Address))([Address.create({ city: "London" })])).toBe('[{"city":"London"}]');
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
    expect(() => User.hydrate({ name: "Grace", createdAt: new Date(1) } as never)).toThrow();
  });

  it("constructs runtime types directly from validator output without a second parse", () => {
    let parses = 0;
    const User = JIT.class(
      JIT.object({
        name: JIT.string().refine(() => {
          parses++;
          return true;
        }),
      })
    );

    expect(JIT.parse(User)({ name: "Ada" })).toBeInstanceOf(User);
    expect(parses).toBe(1);
  });

  it("makes class construction explicit in fused JSON execution plans", () => {
    const User = JIT.class(JIT.object({ id: JIT.string().default("generated"), name: JIT.string() }));
    const parseJson = JIT.json.parse(User).validate();

    expect(parseJson.plan.stages.map((stage) => stage.kind)).toEqual(["json.decode", "validate", "construct"]);
    expect(parseJson('{"name":"Ada"}')).toBeInstanceOf(User);
  });

  it("renames or disables static construction factories without retaining aliases", () => {
    const User = JIT.class(UserSchema).factories({ create: "make", hydrate: "restore" });
    const FactorylessUser = JIT.class(UserSchema).factories({ create: false, hydrate: "restore" });

    expect(User.make({ name: "Ada" })).toBeInstanceOf(User);
    expect(User.restore({ id: "u_1", name: "Ada", createdAt: new Date(0) })).toBeInstanceOf(User);
    expect("create" in User).toBe(false);
    expect("hydrate" in User).toBe(false);
    expect("create" in FactorylessUser).toBe(false);
    expect(FactorylessUser.restore({ id: "u_1", name: "Ada", createdAt: new Date(0) })).toBeInstanceOf(FactorylessUser);
    // @ts-expect-error renamed create factory is the only construction alias
    void User.create;
    // @ts-expect-error disabled create factory is absent
    void FactorylessUser.create;
  });

  it("emits real private backing fields with configurable public accessors", () => {
    const User = JIT.class(JIT.object({ id: JIT.string(), passwordHash: JIT.string() })).accessors({
      default: { field: "private", get: "public", set: "protected" },
      fields: { id: { set: false }, passwordHash: { get: "protected", set: "protected" } },
    });
    const user = User.create({ id: "u_1", passwordHash: "secret" });

    expect(user.id).toBe("u_1");
    expect(Object.keys(user)).toEqual([]);
    expect(Object.getOwnPropertyDescriptor(User.prototype, "id")?.set).toBeUndefined();
    expect(Object.getOwnPropertyDescriptor(User.prototype, "passwordHash")?.get).toBeDefined();
    expect("#p0" in user).toBe(false);
    expectTypeOf(User.accessors).toBeFunction();
    // @ts-expect-error accessor keys are constrained to the runtime schema fields
    User.accessors({ fields: { missing: { set: false } } });
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

  it("preserves value-object capabilities through an abstract subclass", () => {
    const MoneyBase = JIT.ddd.valueObject.abstract(
      JIT.object({ amount: JIT.number(), currency: JIT.enum(["BRL", "USD"]) })
    );
    class Money extends MoneyBase {}

    const money = Money.create({ amount: 10, currency: "BRL" });
    const restored = Money.hydrate({ amount: 10, currency: "BRL" });

    expect(money).toBeInstanceOf(Money);
    expect(Object.isFrozen(money)).toBe(true);
    expect(money.equals(restored)).toBe(true);
    expect(money.hashCode()).toBe(restored.hashCode());
    expect(() => MoneyBase.create({ amount: 10, currency: "BRL" })).toThrow(/abstract JIT class/i);
    expectTypeOf(money).toEqualTypeOf<Money>();
    expectTypeOf(money.equals).toBeFunction();
    expectTypeOf(money.hashCode).toBeFunction();
  });

  it("binds identity keys to the object schema", () => {
    const UserBase = JIT.class.abstract(JIT.object({ id: JIT.string(), name: JIT.string() })).identity("id");

    class User extends UserBase {}

    expect(User.create({ id: "u_1", name: "Ada" }).sameIdentity(User.create({ id: "u_1", name: "Grace" }))).toBe(true);
    const assertInvalidIdentity = () => {
      // @ts-expect-error identity keys must be schema fields
      UserBase.identity("missing");
    };
    void assertInvalidIdentity;
  });

  it("touches a configured timestamp once for an effective aggregate mutation", () => {
    const OrderBase = JIT.ddd
      .aggregateRoot(JIT.object({ id: JIT.string(), status: JIT.string(), updatedAt: JIT.date() }), {
        id: "id",
      })
      .timestamps({ updatedAt: "updatedAt" });
    class Order extends OrderBase {
      confirm() {
        this.update({ status: "confirmed" });
      }
    }
    const initial = new Date(0);
    const order = Order.create({ id: "o_1", status: "draft", updatedAt: initial });

    order.confirm();
    expect(order.updatedAt).toBeInstanceOf(Date);
    expect(order.updatedAt.getTime()).toBeGreaterThan(initial.getTime());
  });

  it("combines soft-delete and timestamp metadata in one clock read", () => {
    const OrderBase = JIT.ddd
      .aggregateRoot(JIT.object({ id: JIT.string(), updatedAt: JIT.date(), deletedAt: JIT.date().nullable() }), {
        id: "id",
      })
      .timestamps({ updatedAt: "updatedAt" })
      .softDelete({ field: "deletedAt" });
    class Order extends OrderBase {}
    const order = Order.create({ id: "o_1", updatedAt: new Date(0), deletedAt: null });

    order.softDelete();
    expect(order.isDeleted).toBe(true);
    expect(order.deletedAt).toBe(order.updatedAt);
    order.restore();
    expect(order.isDeleted).toBe(false);
  });

  it("increments a schema-bound version only after an effective mutation", () => {
    const OrderBase = JIT.ddd
      .aggregateRoot(JIT.object({ id: JIT.string(), status: JIT.string(), version: JIT.int() }), {
        id: "id",
      })
      .versioned({ field: "version" });
    class Order extends OrderBase {
      confirm() {
        this.update({ status: "confirmed" });
      }
    }
    const order = Order.create({ id: "o_1", status: "draft", version: 3 });

    order.confirm();
    expect(order.version).toBe(4);
    order.confirm();
    expect(order.version).toBe(4);
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
        id: JIT.string().readonly().default("u_1"),
        name: JIT.string(),
        profile: JIT.object({ label: JIT.string() }),
      })
    ).use(JIT.class.with);
    const ada = User.create({
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

  it("validates immutable with() state after the structural update", () => {
    let validations = 0;
    const User = JIT.class(
      JIT.object({
        name: JIT.string().refine(() => {
          validations++;
          return true;
        }),
      })
    ).use(JIT.class.with);
    const ada = User.create({ name: "Ada" });

    validations = 0;
    expect(ada.with({ name: "Grace" })).toMatchObject({ name: "Grace" });
    expect(validations).toBe(1);
  });

  it("preserves readonly fields when default is the outer wrapper of aggregate state", () => {
    const OrderBase = JIT.ddd.aggregateRoot(
      JIT.object({
        id: JIT.string().readonly().default("o_1"),
        status: JIT.string(),
      }),
      { id: "id" }
    );
    class Order extends OrderBase {
      confirm() {
        this.update({ status: "confirmed" });
      }

      assertReadonlyTyping() {
        // @ts-expect-error readonly fields stay absent from aggregate patches
        this.update({ id: "o_2" });
      }
    }
    const order = Order.create({ status: "draft" });

    order.confirm();

    expect(order).toMatchObject({ id: "o_1", status: "confirmed" });
    void order.assertReadonlyTyping;
  });

  it("builds frozen value objects from the same class capabilities", () => {
    const Money = JIT.ddd.valueObject(
      JIT.object({
        amount: JIT.number(),
        currency: JIT.enum(["BRL", "USD"]),
      })
    );
    const money = Money.create({ amount: 10, currency: "BRL" });

    expect(Object.isFrozen(money)).toBe(true);
    expect(money.equals(Money.create({ amount: 10, currency: "BRL" }))).toBe(true);
    expect(money.hashCode()).toBe(Money.create({ amount: 10, currency: "BRL" }).hashCode());
  });

  it("builds abstract entities with identity separate from structural equality", () => {
    const UserBase = JIT.ddd.entity(JIT.object({ id: JIT.string(), name: JIT.string() }), { id: "id" });

    class User extends UserBase {}

    expect(User.create({ id: "u_1", name: "Ada" }).sameIdentity(User.create({ id: "u_1", name: "Grace" }))).toBe(true);
    expect(() => UserBase.create({ id: "u_1", name: "Ada" })).toThrow(/abstract JIT class/i);
    if (Object.is(1, 2)) {
      // @ts-expect-error identity must name an existing schema field
      JIT.ddd.entity(JIT.object({ id: JIT.string() }), { id: "missing" });
    }
  });

  it("keeps aggregate events ordered and applies updates through static assignments", () => {
    const OrderBase = JIT.ddd.aggregateRoot(
      JIT.object({
        id: JIT.string().readonly(),
        status: JIT.enum(["draft", "confirmed"]),
      }),
      { id: "id" }
    );
    class Order extends OrderBase {
      confirm() {
        this.update({ status: "confirmed" });
        this.raise({ type: "order.confirmed" });
      }

      notify() {
        this.raise({ type: "order.notified" });
      }
    }

    const order = Order.create({ id: "o_1", status: "draft" });
    order.confirm();
    order.notify();

    expect(order.status).toBe("confirmed");
    expect(order.peekEvents()).toEqual([{ type: "order.confirmed" }, { type: "order.notified" }]);
    expect(order.pullEvents()).toEqual([{ type: "order.confirmed" }, { type: "order.notified" }]);
    expect(order.peekEvents()).toEqual([]);
    if (Object.is(1, 2)) {
      // @ts-expect-error domain events can only be raised from aggregate behavior
      order.raise({ type: "external" });
      // @ts-expect-error aggregate mutation is domain-internal
      order.update({ status: "draft" });
    }
  });

  it("keeps compiled structural sharing for composite aggregate fields", () => {
    const OrderBase = JIT.ddd.aggregateRoot(
      JIT.object({
        id: JIT.string().readonly(),
        shipping: JIT.object({ city: JIT.string(), country: JIT.string() }),
      }),
      { id: "id" }
    );
    class Order extends OrderBase {
      shipTo(city: string) {
        this.update({ shipping: { city } });
      }
    }
    const order = Order.create({ id: "o_1", shipping: { city: "Recife", country: "BR" } });

    order.shipTo("Sao Paulo");
    expect(order.shipping).toEqual({ city: "Sao Paulo", country: "BR" });
    const updated = order.shipping;
    order.shipTo("Sao Paulo");
    expect(order.shipping).toBe(updated);
  });

  it("commits aggregate events in order and retains them when publication fails", async () => {
    const OrderBase = JIT.ddd.aggregateRoot(JIT.object({ id: JIT.string(), status: JIT.string() }), { id: "id" });
    class Order extends OrderBase {
      record(event: unknown) {
        this.raise(event);
      }
    }
    const order = Order.create({ id: "o_1", status: "draft" });
    const published: unknown[] = [];

    order.record({ type: "first" });
    order.record({ type: "second" });
    await order.commit({
      publish: async (event) => {
        published.push(event);
      },
    });
    expect(published).toEqual([{ type: "first" }, { type: "second" }]);
    expect(order.peekEvents()).toEqual([]);

    order.record({ type: "retry" });
    await expect(order.commit({ publish: () => Promise.reject(new Error("offline")) })).rejects.toThrow("offline");
    expect(order.peekEvents()).toEqual([{ type: "retry" }]);
  });

  it("preserves the exact order of typed domain-event history", () => {
    const OrderCreated = JIT.ddd.domainEvent("order.created", {
      version: 1,
      payload: JIT.object({ orderId: JIT.string() }),
    });
    const ItemAdded = JIT.ddd.domainEvent("order.item-added", {
      version: 1,
      payload: JIT.object({ orderId: JIT.string(), sku: JIT.string() }),
    });
    const OrderConfirmed = JIT.ddd.domainEvent("order.confirmed", {
      version: 1,
      payload: JIT.object({ orderId: JIT.string() }),
    });
    const OrderBase = JIT.ddd.aggregateRoot(JIT.object({ id: JIT.string().readonly() }), { id: "id" });
    class Order extends OrderBase {
      recordHistory() {
        this.raise(OrderCreated.create({ orderId: this.id }));
        this.raise(ItemAdded.create({ orderId: this.id, sku: "sku_1" }));
        this.raise(OrderConfirmed.create({ orderId: this.id }));
      }
    }
    const order = Order.create({ id: "o_1" });

    order.recordHistory();
    const events = order.peekEvents();

    expect(events.map((event) => (event as { type: string }).type)).toEqual([
      "order.created",
      "order.item-added",
      "order.confirmed",
    ]);
    expect(events[0]).toBeInstanceOf(OrderCreated);
    expect(events[1]).toBeInstanceOf(ItemAdded);
    expect(events[2]).toBeInstanceOf(OrderConfirmed);
    expect(order.pullEvents()).toEqual(events);
    expect(order.peekEvents()).toEqual([]);
  });

  it("keeps nested Runtime Classes atomic while updating an aggregate", () => {
    const Money = JIT.ddd.valueObject(JIT.object({ amount: JIT.number(), currency: JIT.enum(["BRL", "USD"]) }));
    const OrderBase = JIT.ddd.aggregateRoot(
      JIT.object({ id: JIT.string().readonly(), status: JIT.enum(["draft", "confirmed"]), total: Money }),
      { id: "id" }
    );
    class Order extends OrderBase {
      confirm() {
        this.update({ status: "confirmed" });
      }
    }
    const order = Order.create({ id: "o_1", status: "draft", total: { amount: 120, currency: "BRL" } });
    const originalMoney = order.total;

    order.confirm();

    expect(order.status).toBe("confirmed");
    expect(order.total).toBe(originalMoney);
    expect(order.total).toBeInstanceOf(Money);
  });

  it("creates immutable, versioned domain events from payload input", () => {
    const OrderConfirmed = JIT.ddd.domainEvent("order.confirmed", {
      version: 1,
      payload: JIT.object({ orderId: JIT.string().min(1) }),
    });
    const event = OrderConfirmed.create({ orderId: "o_1" });
    const constructed = new OrderConfirmed({ type: "order.confirmed", version: 1, payload: { orderId: "o_1" } });

    expect(event).toBeInstanceOf(OrderConfirmed);
    expect(Object.isFrozen(event)).toBe(true);
    expect(event).toMatchObject({
      type: "order.confirmed",
      version: 1,
      payload: { orderId: "o_1" },
    });
    expect(event.id).toEqual(expect.any(String));
    expect(event.occurredAt).toBeInstanceOf(Date);
    expect(event["~event"]).toEqual({ version: 1, type: "order.confirmed", schemaVersion: 1 });
    expect(constructed).toMatchObject({ type: "order.confirmed", version: 1, payload: { orderId: "o_1" } });
    expect(JIT.parse(OrderConfirmed)(event)).toBeInstanceOf(OrderConfirmed);
    const json = JIT.json.stringify(OrderConfirmed)(event);
    const restored = JIT.json.parse(OrderConfirmed).validate()(json);
    expect(restored).toBeInstanceOf(OrderConfirmed);
    expect(restored.occurredAt).toEqual(event.occurredAt);
    expect(() =>
      JIT.json.parse(OrderConfirmed).validate()('{"type":"order.confirmed","version":1,"payload":{"orderId":"o_1"}}')
    ).toThrow();
    expectTypeOf(event.type).toEqualTypeOf<"order.confirmed">();
    expectTypeOf(event.version).toEqualTypeOf<1>();
    expectTypeOf(event.payload).toEqualTypeOf<{ orderId: string }>();
    expectTypeOf(OrderConfirmed.hydrate(event)).toEqualTypeOf<typeof event>();
    if (Object.is(1, 2)) {
      // @ts-expect-error domain-event creation accepts payload input, not persisted envelope state
      OrderConfirmed.create({ type: "order.confirmed", orderId: "o_1" });
      // @ts-expect-error required event payload fields remain required
      OrderConfirmed.create({});
      // @ts-expect-error direct construction receives the event envelope, not only its payload
      new OrderConfirmed({ orderId: "o_1" });
    }
  });
});

describe("JIT.ddd", () => {
  it("is the only place the domain presets are reachable from", () => {
    expect(Object.keys(JIT.ddd)).toEqual(["valueObject", "entity", "aggregateRoot", "domainEvent"]);

    // The presets are a vocabulary, not schema factories: they do not sit next
    // to JIT.string() where someone reaching for an entity has to scan past them.
    for (const preset of ["valueObject", "entity", "aggregateRoot", "domainEvent"] as const) {
      expect(JIT).not.toHaveProperty(preset);
      expect(typeof JIT.ddd[preset]).toBe("function");
    }
    // The primitive the presets configure stays top level: DTOs, JSON
    // pipelines and AOT class artifacts build on it with no domain meaning.
    expect(typeof JIT.class).toBe("function");
    // Statics survive the move.
    expect(typeof JIT.ddd.valueObject.abstract).toBe("function");
  });
});
