import { JIT } from "@jit-compiler/jit";
import { runSuite } from "../shared/persist.js";
import { registerScenario } from "../shared/scenario.js";

const UserState = JIT.object({ id: JIT.string(), name: JIT.string(), active: JIT.boolean() });
const Money = JIT.ddd.valueObject(JIT.object({ amount: JIT.number(), currency: JIT.string() }));
const UserBase = JIT.ddd.entity(UserState, { id: "id" });
const OrderBase = JIT.ddd.aggregateRoot(
  JIT.object({ id: JIT.string().readonly(), status: JIT.enum(["draft", "confirmed"]) }),
  { id: "id" }
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

const userInput = { id: "u_1", name: "Ada", active: true };
const moneyInput = { amount: 10, currency: "BRL" };
const runtimeUser = User.create(userInput);
const runtimeSameUser = User.create({ ...userInput, name: "Grace" });
const runtimeMoney = Money.create(moneyInput);
const runtimeSameMoney = Money.create(moneyInput);
const runtimeOrder = Order.create({ id: "o_1", status: "draft" });
const handwrittenOrder = new HandwrittenOrder("o_1", "draft");
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
  ],
});

registerScenario({
  op: "value object read",
  name: "scalar value accessor",
  args: [email],
  jit: (instance: typeof email) => instance.value,
  competitors: [{ name: "handwritten wrapper", fn: () => handwrittenEmail.value }],
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
const persistedId = "7f8f4f83-f3c7-4bad-9b73-a3b70f47d761";
const aliasId = "f63ca4d3-2b8f-49e6-80ff-0cedaf1e6504";
const nestedState = { id: persistedId, name: "Ada", email: "ada@example.com", aliases: [aliasId] };

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
  ],
});

registerScenario({
  op: "entity create",
  name: "defaulted nested identifier",
  args: [{ name: "Ada", email: "ada@example.com", aliases: [] }],
  jit: (input: { name: string; email: string; aliases: string[] }) => NestedUser.create(input),
  competitors: [],
});

const PlainMoney = JIT.ddd.valueObject(JIT.object({ amount: JIT.number(), currency: JIT.string() }));
const ResultMoney = JIT.ddd.valueObject(JIT.object({ amount: JIT.number(), currency: JIT.string() })).validate({
  result: "result",
});
const AssertedMoney = JIT.ddd
  .valueObject(JIT.object({ amount: JIT.number(), currency: JIT.string() }))
  .validate({ result: "result" })
  .assert((query) => query.gte("amount", 0));

registerScenario({
  op: "factory policy",
  name: "accepted input",
  args: [moneyInput],
  jit: (input: typeof moneyInput) => PlainMoney.create(input),
  competitors: [
    { name: "result policy", fn: (input: typeof moneyInput) => ResultMoney.create(input) },
    { name: "result policy + assertion", fn: (input: typeof moneyInput) => AssertedMoney.create(input) },
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
    { name: "result policy", fn: (input: unknown) => ResultMoney.create(input as typeof moneyInput) },
    { name: "result policy + assertion", fn: (input: unknown) => AssertedMoney.create(input as typeof moneyInput) },
  ],
});

await runSuite("classes");
