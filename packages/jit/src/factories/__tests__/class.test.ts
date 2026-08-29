import { DomainAssertionError, JITValidationError } from "../../errors/index.js";
import { JIT } from "../../index.js";
import { getArtifact } from "../../runtime/artifact-registry.js";

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

  it("exposes exactly one canonical construction boundary", () => {
    const Plain = JIT.class(JIT.object({ value: JIT.string() }));
    const Factory = JIT.class(JIT.object({ value: JIT.string() })).factories({ create: "create", hydrate: "hydrate" });
    const Value = JIT.ddd.valueObject(JIT.object({ value: JIT.string() }));
    const Entity = JIT.ddd.entity(JIT.object({ id: JIT.string() }), { id: "id" });

    expect(new Plain({ value: "plain" })).toBeInstanceOf(Plain);
    expect("create" in Plain).toBe(false);
    expect(Factory.create({ value: "factory" })).toBeInstanceOf(Factory);
    expect(Value.create({ value: "vo" })).toBeInstanceOf(Value);
    expect(
      () =>
        new (Factory as unknown as new (input: unknown) => unknown)({
          value: "direct",
        })
    ).toThrow(/factory construction/i);
    expect(() => new (Value as unknown as new (input: unknown) => unknown)({ value: "direct" })).toThrow(
      /factory construction/i
    );
    expect(() => new (Entity as unknown as new (input: unknown) => unknown)({ id: "direct" })).toThrow(
      /factory construction/i
    );

    if (Object.is(1, 2)) {
      // @ts-expect-error constructor-first classes have no default factory
      Plain.create({ value: "x" });
      // @ts-expect-error factory-only Runtime Types cannot be directly constructed
      new Factory({ value: "x" });
      // @ts-expect-error DDD Value Objects are factory-only
      new Value({ value: "x" });
      // @ts-expect-error DDD Entities are factory-only
      new Entity({ id: "x" });
    }
  });

  it("constructs instances in schema-field order after compiled validation", () => {
    const User = JIT.class(UserSchema);
    const user = new User({ name: "Ada" });

    expect(user).toBeInstanceOf(User);
    expect(user).toEqual({
      id: "generated",
      name: "Ada",
      createdAt: new Date(0),
    });
    expect(Object.keys(user)).toEqual(["id", "name", "createdAt"]);
    expect("create" in User).toBe(false);
    expect("hydrate" in User).toBe(false);
    // @ts-expect-error JIT.class has one constructor-first boundary by default
    void User.create;
    expect(() => new User({ name: "x" })).toThrow(/at least 2 characters/i);
    expect(User.schema.def.innerType).toBe(UserSchema.schema);
    expectTypeOf(user).toEqualTypeOf<JIT.Typeof<typeof User>>();
    expectTypeOf<JIT.Hydrate<typeof User>>().toEqualTypeOf<JIT.Typeof<typeof UserSchema>>();
    expectTypeOf<JIT.Wire<typeof User>>().toEqualTypeOf<JIT.Typeof<typeof UserSchema>>();
  });

  it("materializes nested runtime classes through the compiled validator", () => {
    const Address = JIT.class(JIT.object({ city: JIT.string() }));
    const User = JIT.class(JIT.object({ name: JIT.string(), address: Address, addresses: JIT.array(Address) }));
    const user = new User({
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
    const user = new User({ name: "Ada", address: { city: "London" } });

    expect(JIT.json.stringify(User)(user)).toBe('{"name":"Ada","address":{"city":"London"}}');
    expect(JIT.json.stringify(JIT.array(Address))([new Address({ city: "London" })])).toBe('[{"city":"London"}]');
  });

  it("hydrates validated state without applying a distinct construction path", () => {
    const User = JIT.class(UserSchema).factories({ create: false, hydrate: "hydrate" });
    const state = { id: "u_1", name: "Grace", createdAt: new Date(1) };

    expect(User.hydrate(state)).toBeInstanceOf(User);
    expect(JIT.validate.parse(User)(state)).toBeInstanceOf(User);
    expect(JIT.validate.safeParse(User)(state)).toMatchObject({
      success: true,
      data: expect.any(User),
    });
    expectTypeOf(JIT.validate.parse(User)).toMatchTypeOf<(value: unknown) => InstanceType<typeof User>>();
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

    expect(JIT.validate.parse(User)({ name: "Ada" })).toBeInstanceOf(User);
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
    const user = new User({ id: "u_1", passwordHash: "secret" });

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
    const UserBase = JIT.class.abstract(UserSchema).factories({ create: "create", hydrate: "hydrate" });

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
    expect(money.value).toBe(money);
    expect(money.value.amount).toBe(10);
    expect(() => MoneyBase.create({ amount: 10, currency: "BRL" })).toThrow(/abstract JIT class/i);
    expectTypeOf(money).toEqualTypeOf<Money>();
    expectTypeOf(money.equals).toBeFunction();
    expectTypeOf(money.hashCode).toBeFunction();
    expectTypeOf(money.value.amount).toEqualTypeOf<number>();
  });

  it("represents scalar value objects as immutable runtime objects", () => {
    const Email = JIT.ddd.valueObject(JIT.string().email());
    const first = Email.create("ada@example.com");
    const same = Email.hydrate("ada@example.com");
    const different = Email.create("grace@example.com");

    expect(first).toBeInstanceOf(Email);
    expect(first.value).toBe("ada@example.com");
    expect(first.equals(same)).toBe(true);
    expect(first.equals(different)).toBe(false);
    expect(first.hashCode()).toBe(same.hashCode());
    expect(Object.isFrozen(first)).toBe(true);
    expect(JSON.stringify(first)).toBe('"ada@example.com"');
    expect(JIT.json.stringify(Email)(first)).toBe('"ada@example.com"');
    expectTypeOf(first.value).toEqualTypeOf<string>();
    expectTypeOf(first.equals).toBeFunction();
    expectTypeOf(first.hashCode).toBeFunction();
    if (Object.is(1, 2)) {
      // @ts-expect-error scalar Value Objects are factory-only
      void new Email("ada@example.com");
    }
  });

  it("infers zero-argument creation from a scalar schema default", () => {
    const Identifier = JIT.ddd.valueObject(JIT.string().default("generated"));

    expect(Identifier.create().value).toBe("generated");
    expect(Identifier.create("provided").value).toBe("provided");
  });

  it("creates default and custom unique identifier Value Objects", () => {
    const UserId = JIT.ddd.uniqueIdentifier();
    const NumericId = JIT.ddd.uniqueIdentifier(JIT.int().positive());
    const persisted = "7f8f4f83-f3c7-4bad-9b73-a3b70f47d761";

    expect(UserId.create().value).toMatch(/^[0-9a-f-]{36}$/i);
    expect(UserId.create(persisted).value).toBe(persisted);
    expect(UserId.hydrate(persisted).value).toBe(persisted);
    expect(NumericId.create(42).value).toBe(42);
    expect(() => NumericId.create(-1)).toThrow(/positive number/i);
    expectTypeOf(UserId.create().value).toEqualTypeOf<string>();
    expectTypeOf(NumericId.create(1).value).toEqualTypeOf<number>();
  });

  it("infers one identifier and materializes nested Runtime Types at both boundaries", () => {
    const UserId = JIT.ddd.uniqueIdentifier();
    const UserBase = JIT.ddd.entity(
      JIT.object({
        id: UserId,
        name: JIT.string(),
        aliases: JIT.array(UserId),
      })
    );
    class User extends UserBase {}
    const persisted = "7f8f4f83-f3c7-4bad-9b73-a3b70f47d761";
    const alias = "f63ca4d3-2b8f-49e6-80ff-0cedaf1e6504";

    const created = User.create({ name: "Ada", aliases: [alias] });
    const hydrated = User.hydrate({ id: persisted, name: "Ada", aliases: [alias] });
    const sameIdentity = User.hydrate({ id: persisted, name: "Grace", aliases: [] });

    expect(created.id).toBeInstanceOf(UserId);
    expect(created.id.value).toMatch(/^[0-9a-f-]{36}$/i);
    expect(created.aliases[0]).toBeInstanceOf(UserId);
    expect(created.aliases[0].value).toBe(alias);
    expect(hydrated.id).toBeInstanceOf(UserId);
    expect(hydrated.id.value).toBe(persisted);
    expect(hydrated.sameIdentity(sameIdentity)).toBe(true);
    expect(JIT.json.stringify(User)(hydrated)).toBe(`{"id":"${persisted}","name":"Ada","aliases":["${alias}"]}`);
    expect(() => User.hydrate({ name: "Ada", aliases: [] } as never)).toThrow();
    expectTypeOf(created.id.value).toEqualTypeOf<string>();
    expectTypeOf(hydrated.aliases[0]!.value).toEqualTypeOf<string>();
    if (Object.is(1, 2)) {
      // A creation default is not a persistence default: hydrate keeps the
      // identifier required even though create may omit it.
      // @ts-expect-error hydrate never regenerates a persisted default
      User.hydrate({ name: "Ada", aliases: [] });
      // The boundary takes the scalar wire value, not the wrapper.
      User.create({ id: persisted, name: "Ada", aliases: [alias] });
      // @ts-expect-error a nested Runtime Type is materialized, not supplied
      User.create({ id: UserId.create(), name: "Ada", aliases: [] });
    }
  });

  it("requires explicit identity when inference is absent or ambiguous", () => {
    const UserId = JIT.ddd.uniqueIdentifier();
    const TenantId = JIT.ddd.uniqueIdentifier();
    const AmbiguousSchema = JIT.object({ id: UserId, tenantId: TenantId });
    const PlainSchema = JIT.object({ id: JIT.string() });

    expect(() => (JIT.ddd.entity as (schema: unknown) => unknown)(AmbiguousSchema)).toThrow(
      /multiple unique identifiers/i
    );
    expect(() => (JIT.ddd.entity as (schema: unknown) => unknown)(PlainSchema)).toThrow(/no unique identifier/i);
    expect(JIT.ddd.entity(AmbiguousSchema, { id: "id" }).schema).toBeDefined();
    expect(JIT.ddd.entity(PlainSchema, { id: "id" }).schema).toBeDefined();
    if (Object.is(1, 2)) {
      // @ts-expect-error ambiguous identifier metadata requires an explicit field
      JIT.ddd.entity(AmbiguousSchema);
      // @ts-expect-error schemas without identifier metadata require an explicit field
      JIT.ddd.entity(PlainSchema);
    }
  });

  describe("factory result policies and assertions", () => {
    const MoneySchema = JIT.object({ amount: JIT.number(), currency: JIT.enum(["BRL", "USD"]) });
    const valid = { amount: 10, currency: "BRL" } as const;
    const invalid = { amount: "x", currency: "BRL" } as never;

    it("costs nothing until a policy is configured", () => {
      const Money = JIT.ddd.valueObject(MoneySchema);
      const artifact = getArtifact(Money as object);

      expect(Money.create(valid).amount).toBe(10);
      expect(() => Money.create(invalid)).toThrow(JITValidationError);
      // No policy on the artifact means no policy in the generated module.
      expect(artifact?.kind === "class" && artifact.policy).toBeUndefined();
    });

    it("reports a rejected input in the shape the artifact declared", () => {
      const Throwing = JIT.ddd.valueObject(MoneySchema).validate();
      const Result = JIT.ddd.valueObject(MoneySchema).validate({ result: "result" });
      const Tuple = JIT.ddd.valueObject(MoneySchema).validate({ result: "tuple" });

      expect(() => Throwing.create(invalid)).toThrow(JITValidationError);
      expect(Throwing.create(valid).amount).toBe(10);

      const ok = Result.create(valid);
      const bad = Result.create(invalid);
      expect(ok.ok).toBe(true);
      expect(ok.ok === true && ok.value.amount).toBe(10);
      expect(bad.ok).toBe(false);
      expect(bad.ok === false && bad.error).toBeInstanceOf(JITValidationError);

      const [noError, value] = Tuple.create(valid);
      const [error, noValue] = Tuple.create(invalid);
      expect(noError).toBeUndefined();
      expect(value?.amount).toBe(10);
      expect(error).toBeInstanceOf(JITValidationError);
      expect(noValue).toBeUndefined();

      expectTypeOf(Throwing.create(valid)).toHaveProperty("amount");
      expectTypeOf(Result.create(valid)).toHaveProperty("ok");
      expectTypeOf(Tuple.create(valid)).toHaveProperty(0);
    });

    it("covers hydration and lets a phase keep the built-in behavior", () => {
      const Both = JIT.ddd.valueObject(MoneySchema).validate({ result: "result" });
      const CreateOnly = JIT.ddd.valueObject(MoneySchema).validate({ result: "result", hydrate: false });

      expect(Both.hydrate(invalid).ok).toBe(false);
      expect(Both.hydrate(valid).ok).toBe(true);
      // hydrate was left out of the policy, so it keeps throwing.
      expect(() => CreateOnly.hydrate(invalid)).toThrow(JITValidationError);
      expect(CreateOnly.create(invalid).ok).toBe(false);
    });

    it("builds the error the artifact configured", () => {
      class InvalidMoney extends Error {}
      const Money = JIT.ddd
        .valueObject(MoneySchema)
        .validate({ result: "result", error: (issues) => new InvalidMoney(issues[0]?.message) });
      const rejected = Money.create(invalid);

      expect(rejected.ok).toBe(false);
      expect(rejected.ok === false && rejected.error).toBeInstanceOf(InvalidMoney);
      expectTypeOf(rejected).toHaveProperty("ok");
      if (rejected.ok === false) expectTypeOf(rejected.error).toEqualTypeOf<InvalidMoney>();
    });

    it("compiles a domain invariant from the shared condition builder", () => {
      const Money = JIT.ddd.valueObject(MoneySchema).assert((query) => query.gte("amount", 0));
      const artifact = getArtifact(Money as object);

      expect(Money.create(valid).amount).toBe(10);
      expect(() => Money.create({ amount: -1, currency: "BRL" })).toThrow(DomainAssertionError);
      try {
        Money.create({ amount: -1, currency: "BRL" });
      } catch (error) {
        expect((error as DomainAssertionError).field).toBe("amount");
        expect((error as DomainAssertionError).rule).toBe("amount");
      }
      // The invariant is generated source, not a stored callback.
      if (artifact?.kind !== "class") throw new Error("expected a class artifact");
      expect(artifact.policy?.assertions?.source).toContain("value.amount >=");
      // A domain assertion is not a schema failure: the two report differently.
      expect(() => Money.create(invalid)).toThrow(JITValidationError);
    });

    it("lets an assertion name its own rule and build its own error", () => {
      class NegativeMoney extends Error {}
      const Money = JIT.ddd
        .valueObject(MoneySchema)
        .validate({ result: "result" })
        .assert((query) => query.gte("amount", 0), {
          rule: "non-negative",
          error: () => new NegativeMoney("negative"),
        });
      const rejected = Money.create({ amount: -1, currency: "BRL" });

      expect(rejected.ok).toBe(false);
      expect(rejected.ok === false && rejected.error).toBeInstanceOf(NegativeMoney);
      expect(Money.create(valid).ok).toBe(true);
    });

    it("refuses an assertion where there are no fields to name", () => {
      const Email = JIT.ddd.valueObject(JIT.string().email());

      expect(() => (Email as unknown as { assert(fn: unknown): unknown }).assert(() => undefined)).toThrow(
        /object fields/i
      );
    });

    it("applies the policy to entities and their subclasses", () => {
      const UserBase = JIT.ddd
        .entity(JIT.object({ id: JIT.string(), age: JIT.number() }), { id: "id" })
        .validate({ result: "result" })
        .assert((query) => query.gte("age", 18), { rule: "adult" });
      class User extends UserBase {}

      const ok = User.create({ id: "u_1", age: 20 });
      const tooYoung = User.create({ id: "u_1", age: 10 });

      expect(ok.ok === true && ok.value).toBeInstanceOf(User);
      expect(tooYoung.ok).toBe(false);
      expect(tooYoung.ok === false && (tooYoung.error as { rule?: string }).rule).toBe("adult");
    });
  });

  describe("clone capability", () => {
    const Schema = JIT.object({ id: JIT.string(), tags: JIT.array(JIT.string()) });

    it("copies state through the shared clone plan", () => {
      const User = JIT.class(Schema).use(JIT.class.clone);
      const user = new User({ id: "u_1", tags: ["a"] });
      const copy = user.clone();

      expect(copy).toEqual(user);
      expect(copy).not.toBe(user);
      expect(copy).toBeInstanceOf(User);
      // A clone is a copy of the state, not a shared reference to it.
      expect(copy.tags).not.toBe(user.tags);
      // `clone` returns the instance type, the way `with` does.
      expectTypeOf(copy).toHaveProperty("tags");
      expectTypeOf(user.clone).toBeFunction();
    });

    it("is absent until it is asked for", () => {
      const Plain = JIT.class(Schema);
      const Email = JIT.ddd.valueObject(JIT.string().email());

      expect("clone" in new Plain({ id: "u_1", tags: [] })).toBe(false);
      // A Value Object is its value; copying one answers nothing.
      expect("clone" in Email.create("ada@example.com")).toBe(false);
    });

    it("preserves entity identity and starts an aggregate copy with no events", () => {
      const EntityBase = JIT.ddd.entity(Schema, { id: "id" }).use(JIT.class.clone);
      class Member extends EntityBase {}
      const member = Member.create({ id: "u_1", tags: ["a"] });
      const memberCopy = member.clone();

      // Two objects claiming to be the same entity: the reason this is opt-in.
      expect(memberCopy.sameIdentity(member)).toBe(true);
      expect(memberCopy).not.toBe(member);

      const OrderBase = JIT.ddd
        .aggregateRoot(JIT.object({ id: JIT.string().readonly(), status: JIT.enum(["draft", "confirmed"]) }), {
          id: "id",
        })
        .use(JIT.class.clone);
      class Order extends OrderBase {
        confirm() {
          this.update({ status: "confirmed" });
          this.raise({ type: "order.confirmed" });
        }
      }
      const order = Order.create({ id: "o_1", status: "draft" });
      order.confirm();
      const orderCopy = order.clone();

      expect(order.peekEvents()).toHaveLength(1);
      expect(orderCopy.status).toBe("confirmed");
      // The pending events belong to the transition that raised them.
      expect(orderCopy.peekEvents()).toHaveLength(0);
    });
  });

  it("binds identity keys to the object schema", () => {
    const UserBase = JIT.class
      .abstract(JIT.object({ id: JIT.string(), name: JIT.string() }))
      .identity("id")
      .factories({ create: "create", hydrate: "hydrate" });

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
    const ada = new User({ name: "Ada" });
    const same = new User({ name: "Ada" });
    const grace = new User({ name: "Grace" });

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
    const ada = new User({
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
    const ada = new User({ name: "Ada" });

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
    expect(
      () =>
        new (OrderConfirmed as unknown as new (input: unknown) => unknown)({
          type: "order.confirmed",
          version: 1,
          payload: { orderId: "o_1" },
        })
    ).toThrow(/factory construction/i);
    expect(JIT.validate.parse(OrderConfirmed)(event)).toBeInstanceOf(OrderConfirmed);
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
    expect(Object.keys(JIT.ddd)).toEqual(["valueObject", "entity", "aggregateRoot", "domainEvent", "uniqueIdentifier"]);

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
