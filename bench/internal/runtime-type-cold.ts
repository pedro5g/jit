import { performance } from "node:perf_hooks";
import { JIT } from "@jit-compiler/jit";

const started = performance.now();
const Money = JIT.ddd.valueObject(JIT.object({ amount: JIT.number(), currency: JIT.string() }));
const Order = JIT.ddd.entity(JIT.object({ id: JIT.string(), total: Money }), { id: "id" });
const order = Order.create({ id: "o_1", total: { amount: 10, currency: "BRL" } });
const same = Order.create({ id: "o_1", total: { amount: 10, currency: "BRL" } });
if (!order.equals(same)) throw new Error("cold Runtime Type probe did not compare equal instances");
console.log(
  JSON.stringify([
    {
      operation: "cold compile + first Runtime Type call",
      milliseconds: Number((performance.now() - started).toFixed(4)),
    },
  ])
);
