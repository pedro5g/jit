import { JIT } from "@jit-compiler/jit";
import { loadAotArtifacts } from "../shared/aot.js";
import { runSuite } from "../shared/persist.js";
import { registerScenario } from "../shared/scenario.js";

const UserState = JIT.object({
  id: JIT.string(),
  name: JIT.string(),
  active: JIT.boolean(),
});
const Money = JIT.ddd.valueObject(JIT.object({ amount: JIT.number(), currency: JIT.string() }));
const UserBase = JIT.ddd.entity(UserState, { id: "id" });
const OrderBase = JIT.ddd.aggregateRoot(
  JIT.object({
    id: JIT.string().readonly(),
    status: JIT.enum(["draft", "confirmed"]),
  }),
  { id: "id" }
);
const TimestampedOrderBase = JIT.ddd
  .aggregateRoot(
    JIT.object({
      id: JIT.string().readonly(),
      status: JIT.enum(["draft", "confirmed"]),
      updatedAt: JIT.date(),
    }),
    { id: "id" }
  )
  .extends(JIT.ddd.timestamps({ updatedAt: "updatedAt" }));
const fixedClockValue = new Date(1);
const ClockedOrderBase = JIT.ddd
  .aggregateRoot(
    JIT.object({
      id: JIT.string().readonly(),
      status: JIT.enum(["draft", "confirmed"]),
      changedAt: JIT.date(),
    }),
    { id: "id" }
  )
  .extends(
    JIT.ddd.timestamps({
      updatedAt: "changedAt",
      clock: () => fixedClockValue,
    })
  );
const OrderConfirmed = JIT.ddd.domainEvent("order.confirmed", {
  payload: JIT.object({ orderId: JIT.string() }),
  version: 1,
});

class User extends UserBase {}
class Order extends OrderBase {
  toggleStatus(): void {
    this.update({ status: this.status === "draft" ? "confirmed" : "draft" });
  }

  recordAndPull(event: unknown): unknown[] {
    this.raise(event);
    return this.pullEvents();
  }
}

class TimestampedOrder extends TimestampedOrderBase {
  toggleStatus(): void {
    this.update({ status: this.status === "draft" ? "confirmed" : "draft" });
  }
}

class ClockedOrder extends ClockedOrderBase {
  toggleStatus(): void {
    this.update({ status: this.status === "draft" ? "confirmed" : "draft" });
  }
}

class HandwrittenUser {
  constructor(
    readonly id: string,
    readonly name: string,
    readonly active: boolean
  ) {}

  sameIdentity(other: HandwrittenUser): boolean {
    return this.id === other.id;
  }
}

class HandwrittenOrder {
  readonly events: unknown[] = [];

  constructor(
    readonly id: string,
    public status: "draft" | "confirmed"
  ) {}

  update(): void {
    this.status = this.status === "draft" ? "confirmed" : "draft";
  }

  raiseAndPull(): unknown[] {
    this.events.push({ type: "order.confirmed" });
    return this.events.splice(0);
  }
}

class HandwrittenTimestampedOrder {
  constructor(
    readonly id: string,
    public status: "draft" | "confirmed",
    public updatedAt: Date,
    private readonly clock: () => Date
  ) {}

  update(): void {
    this.status = this.status === "draft" ? "confirmed" : "draft";
    this.updatedAt = this.clock();
  }
}

const userInput = { id: "u_1", name: "Ada", active: true };
const moneyInput = { amount: 10, currency: "BRL" };
const runtimeUser = User.create(userInput);
const runtimeSameUser = User.create({ ...userInput, name: "Grace" });
const runtimeMoney = Money.create(moneyInput);
const runtimeSameMoney = Money.create(moneyInput);
const runtimeOrder = Order.create({ id: "o_1", status: "draft" });
const runtimeTimestampedOrder = TimestampedOrder.create({
  id: "o_2",
  status: "draft",
  updatedAt: new Date(0),
});
const runtimeClockedOrder = ClockedOrder.create({
  id: "o_3",
  status: "draft",
  changedAt: new Date(0),
});
const handwrittenOrder = new HandwrittenOrder("o_1", "draft");
const handwrittenTimestampedOrder = new HandwrittenTimestampedOrder("o_2", "draft", new Date(0), () => new Date());
const handwrittenClockedOrder = new HandwrittenTimestampedOrder("o_3", "draft", new Date(0), () => fixedClockValue);
const timestampAot = await loadAotArtifacts({ TimestampedOrderBase });
class AotTimestampedOrder extends timestampAot.TimestampedOrderBase {
  toggleStatus(): void {
    this.update({ status: this.status === "draft" ? "confirmed" : "draft" });
  }
}
const aotTimestampedOrder = AotTimestampedOrder.create({
  id: "o_4",
  status: "draft",
  updatedAt: new Date(0),
});
const parseUser = JIT.json.parse(User).validate();
const userJson = JSON.stringify(userInput);

registerScenario({
  op: "class create",
  name: "flat entity",
  args: [userInput],
  jit: (input: typeof userInput) => User.create(input),
  competitors: [
    {
      name: "handwritten class",
      fn: (input: typeof userInput) => new HandwrittenUser(input.id, input.name, input.active),
      biased: "constructs trusted fields without applying the schema validation performed by User.create",
    },
  ],
});

registerScenario({
  op: "value object equals",
  name: "flat money",
  args: [runtimeMoney, runtimeSameMoney],
  jit: (left: InstanceType<typeof Money>, right: InstanceType<typeof Money>) => left.equals(right),
  competitors: [
    {
      name: "handwritten class",
      fn: (left: InstanceType<typeof Money>, right: InstanceType<typeof Money>) =>
        left.amount === right.amount && left.currency === right.currency,
    },
  ],
});

registerScenario({
  op: "entity identity",
  name: "flat entity",
  args: [runtimeUser, runtimeSameUser],
  jit: (left: User, right: User) => left.sameIdentity(right),
  competitors: [
    {
      name: "handwritten class",
      fn: (left: User, right: User) => left.id === right.id,
    },
  ],
});

registerScenario({
  op: "aggregate mutation",
  name: "toggle status",
  args: [runtimeOrder],
  jit: (order: Order) => order.toggleStatus(),
  competitors: [{ name: "handwritten class", fn: () => handwrittenOrder.update() }],
});

registerScenario({
  op: "aggregate timestamp mutation",
  name: "default clock",
  args: [runtimeTimestampedOrder],
  jit: (order: TimestampedOrder) => order.toggleStatus(),
  competitors: [
    {
      name: "handwritten class",
      fn: () => handwrittenTimestampedOrder.update(),
    },
    { name: "JIT AOT", fn: () => aotTimestampedOrder.toggleStatus() },
  ],
});

registerScenario({
  op: "aggregate timestamp mutation",
  name: "injected clock",
  args: [runtimeClockedOrder],
  jit: (order: ClockedOrder) => order.toggleStatus(),
  competitors: [{ name: "handwritten class", fn: () => handwrittenClockedOrder.update() }],
});

registerScenario({
  op: "aggregate event buffer",
  name: "raise and pull",
  args: [runtimeOrder],
  jit: (order: Order) => order.recordAndPull({ type: "order.confirmed" }),
  competitors: [{ name: "handwritten class", fn: () => handwrittenOrder.raiseAndPull() }],
});

registerScenario({
  op: "domain event create",
  name: "flat payload",
  args: [{ orderId: "o_1" }],
  jit: (input: { orderId: string }) => OrderConfirmed.create(input),
  competitors: [
    {
      name: "handwritten class",
      fn: (input: { orderId: string }) =>
        Object.freeze({
          id: "benchmark",
          type: "order.confirmed",
          version: 1,
          occurredAt: new Date(0),
          payload: input,
        }),
      biased: "fixed id and timestamp avoid the production event factory's entropy and clock reads",
    },
  ],
});

registerScenario({
  op: "JSON validate and construct",
  name: "flat entity",
  args: [userJson],
  jit: parseUser,
  competitors: [
    {
      name: "native JSON plus handwritten class",
      fn: (json: string) => {
        const input = JSON.parse(json) as typeof userInput;
        return new HandwrittenUser(input.id, input.name, input.active);
      },
      biased: "does not apply schema validation before construction",
    },
  ],
});

/**
 * The DDD ergonomics of this phase, measured against a handwritten ceiling.
 *
 * A Value Object wrapper, a nested identifier and an opt-in result policy all
 * add work. The point of these scenarios is to say how much, and to prove the
 * unconfigured artifact did not get slower for the configured one's sake.
 */
const Email = JIT.ddd.valueObject(JIT.string().email());
const UserId = JIT.ddd.uniqueIdentifier();
const valueObjectAot = await loadAotArtifacts({ Email, UserId });

class HandwrittenEmail {
  constructor(readonly value: string) {
    Object.freeze(this);
  }

  equals(other: HandwrittenEmail): boolean {
    return this.value === other.value;
  }
}

const email = Email.create("ada@example.com");
const sameEmail = Email.create("ada@example.com");
const handwrittenEmail = new HandwrittenEmail("ada@example.com");
const handwrittenSameEmail = new HandwrittenEmail("ada@example.com");
const aotEmail = valueObjectAot.Email.create("ada@example.com");
const aotSameEmail = valueObjectAot.Email.create("ada@example.com");

registerScenario({
  op: "value object create",
  name: "scalar wrapper",
  args: ["ada@example.com"],
  jit: (input: string) => Email.create(input),
  competitors: [
    {
      name: "handwritten wrapper",
      fn: (input: string) => new HandwrittenEmail(input),
      biased: "wraps a trusted string without applying the schema's email validation",
    },
    {
      name: "JIT AOT",
      fn: (input: string) => valueObjectAot.Email.create(input),
    },
  ],
});

registerScenario({
  op: "value object equals",
  name: "scalar wrapper",
  args: [email, sameEmail],
  jit: (left: typeof email, right: typeof email) => left.equals(right),
  competitors: [
    {
      name: "handwritten wrapper",
      fn: () => handwrittenEmail.equals(handwrittenSameEmail),
    },
    {
      name: "JIT AOT",
      fn: () => aotEmail.equals(aotSameEmail),
    },
  ],
});

registerScenario({
  op: "value object read",
  name: "scalar value accessor",
  args: [email],
  jit: (instance: typeof email) => instance.value,
  competitors: [
    { name: "handwritten wrapper", fn: () => handwrittenEmail.value },
    { name: "JIT AOT", fn: () => aotEmail.value },
  ],
});

const NestedBase = JIT.ddd.entity(
  JIT.object({
    id: UserId,
    name: JIT.string(),
    email: Email,
    aliases: JIT.array(UserId),
  })
);
class NestedUser extends NestedBase {}
const nestedAot = await loadAotArtifacts({ UserId, Email, NestedBase });
class AotNestedUser extends nestedAot.NestedBase {}
const persistedId = "7f8f4f83-f3c7-4bad-9b73-a3b70f47d761";
const aliasId = "f63ca4d3-2b8f-49e6-80ff-0cedaf1e6504";
const nestedState = {
  id: persistedId,
  name: "Ada",
  email: "ada@example.com",
  aliases: [aliasId],
};

registerScenario({
  op: "entity hydrate",
  name: "nested runtime types",
  args: [nestedState],
  jit: (state: typeof nestedState) => NestedUser.hydrate(state),
  competitors: [
    {
      name: "handwritten materialization",
      fn: (state: typeof nestedState) => ({
        id: new HandwrittenEmail(state.id),
        name: state.name,
        email: new HandwrittenEmail(state.email),
        aliases: state.aliases.map((alias) => new HandwrittenEmail(alias)),
      }),
      biased: "constructs trusted wrappers without applying schema validation",
    },
    {
      name: "JIT AOT",
      fn: (state: typeof nestedState) => AotNestedUser.hydrate(state),
    },
  ],
});

registerScenario({
  op: "entity create",
  name: "defaulted nested identifier",
  args: [{ name: "Ada", email: "ada@example.com", aliases: [] }],
  jit: (input: { name: string; email: string; aliases: string[] }) => NestedUser.create(input),
  competitors: [
    {
      name: "JIT AOT",
      fn: (input: { name: string; email: string; aliases: string[] }) => AotNestedUser.create(input),
    },
  ],
});

const PlainMoney = JIT.ddd.valueObject(JIT.object({ amount: JIT.number(), currency: JIT.string() }));
const ResultMoney = JIT.ddd.valueObject(JIT.object({ amount: JIT.number(), currency: JIT.string() })).validate({
  result: "result",
});
const AssertedMoney = JIT.ddd
  .valueObject(JIT.object({ amount: JIT.number(), currency: JIT.string() }))
  .validate({ result: "result" })
  .assert((query) => query.gte("amount", 0));
const policyAot = await loadAotArtifacts({
  PlainMoney,
  ResultMoney,
  AssertedMoney,
});

registerScenario({
  op: "factory policy",
  name: "accepted input",
  args: [moneyInput],
  jit: (input: typeof moneyInput) => PlainMoney.create(input),
  competitors: [
    {
      name: "result policy",
      fn: (input: typeof moneyInput) => ResultMoney.create(input),
    },
    {
      name: "result policy + assertion",
      fn: (input: typeof moneyInput) => AssertedMoney.create(input),
    },
    {
      name: "JIT AOT",
      fn: (input: typeof moneyInput) => policyAot.PlainMoney.create(input),
    },
    {
      name: "JIT AOT result",
      fn: (input: typeof moneyInput) => policyAot.ResultMoney.create(input),
    },
    {
      name: "JIT AOT result + assertion",
      fn: (input: typeof moneyInput) => policyAot.AssertedMoney.create(input),
    },
  ],
});

registerScenario({
  op: "factory policy",
  name: "rejected input",
  args: [{ amount: "x", currency: "BRL" }],
  jit: (input: unknown) => {
    try {
      return PlainMoney.create(input as typeof moneyInput);
    } catch (error) {
      return error;
    }
  },
  competitors: [
    {
      name: "result policy",
      fn: (input: unknown) => ResultMoney.create(input as typeof moneyInput),
    },
    {
      name: "result policy + assertion",
      fn: (input: unknown) => AssertedMoney.create(input as typeof moneyInput),
    },
    {
      name: "JIT AOT result",
      fn: (input: unknown) => policyAot.ResultMoney.create(input as typeof moneyInput),
    },
    {
      name: "JIT AOT result + assertion",
      fn: (input: unknown) => policyAot.AssertedMoney.create(input as typeof moneyInput),
    },
  ],
});

await runSuite("classes");
