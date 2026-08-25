import { JIT } from "@jit-compiler/jit";
import { runSuite } from "../shared/persist.js";
import { registerScenario } from "../shared/scenario.js";

const UserState = JIT.object({ id: JIT.string(), name: JIT.string(), active: JIT.boolean() });
const Money = JIT.valueObject(JIT.object({ amount: JIT.number(), currency: JIT.string() }));
const UserBase = JIT.entity(UserState, { id: "id" });
const OrderBase = JIT.aggregateRoot(
  JIT.object({ id: JIT.string().readonly(), status: JIT.enum(["draft", "confirmed"] as const) }),
  { id: "id" }
);
const OrderConfirmed = JIT.domainEvent("order.confirmed", {
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

class HandwrittenMoney {
  constructor(
    readonly amount: number,
    readonly currency: string
  ) {
    Object.freeze(this);
  }

  equals(other: HandwrittenMoney): boolean {
    return this.amount === other.amount && this.currency === other.currency;
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
const handwrittenUser = new HandwrittenUser(userInput.id, userInput.name, userInput.active);
const handwrittenSameUser = new HandwrittenUser(userInput.id, "Grace", true);
const runtimeMoney = Money.create(moneyInput);
const runtimeSameMoney = Money.create(moneyInput);
const handwrittenMoney = new HandwrittenMoney(moneyInput.amount, moneyInput.currency);
const handwrittenSameMoney = new HandwrittenMoney(moneyInput.amount, moneyInput.currency);
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
    },
  ],
});

registerScenario({
  op: "value object equals",
  name: "flat money",
  args: [runtimeMoney, runtimeSameMoney],
  jit: (left: InstanceType<typeof Money>, right: InstanceType<typeof Money>) => left.equals(right),
  competitors: [{ name: "handwritten class", fn: () => handwrittenMoney.equals(handwrittenSameMoney) }],
});

registerScenario({
  op: "entity identity",
  name: "flat entity",
  args: [runtimeUser, runtimeSameUser],
  jit: (left: User, right: User) => left.sameIdentity(right),
  competitors: [{ name: "handwritten class", fn: () => handwrittenUser.sameIdentity(handwrittenSameUser) }],
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

await runSuite("classes");
