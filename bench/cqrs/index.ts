import { JIT } from "../../packages/jit/src/index.js";
import { runSuite } from "../shared/persist.js";
import { registerScenario } from "../shared/scenario.js";

const User = JIT.object({ id: JIT.string(), age: JIT.number(), status: JIT.string() });
const parse = JIT.cqrs.parse(
  JIT.cqrs.input(User, {
    filter: { age: ["gte", "lte"], status: ["eq"] },
    sort: ["age"],
    pagination: { type: "offset", defaultLimit: 20, maxLimit: 100 },
  })
);
const input = { filter: { age: { $gte: 18, $lte: 65 }, status: "active" }, sort: "-age", page: 2, limit: 20 };

registerScenario({
  op: "cqrs parse",
  name: "flat filter, sort and offset",
  args: [input],
  jit: parse as (...args: never[]) => unknown,
  competitors: [
    {
      name: "handwritten",
      fn: (value: typeof input) => ({
        filter: [
          { kind: "gte", path: ["age"], value: value.filter.age.$gte },
          { kind: "lte", path: ["age"], value: value.filter.age.$lte },
          { kind: "eq", path: ["status"], value: value.filter.status },
        ],
        sort: [{ path: ["age"], direction: "desc" as const }],
        pagination: { kind: "offset" as const, offset: (value.page - 1) * value.limit, limit: value.limit },
      }),
      biased:
        "assumes an already valid exact input and does not enforce the CQRS schema, allowed fields, operators or pagination budgets",
    },
  ],
});

const rows = Array.from({ length: 1_000 }, (_, id) => ({
  id: String(id),
  age: 16 + (id % 70),
  status: id % 3 === 0 ? "active" : "inactive",
}));
const activeAdults = JIT.cqrs
  .query(User)
  .where((query) => query.gte("age", 18))
  .where((query) => query.eq("status", "active"))
  .select("id", "age")
  .limit(50);

registerScenario({
  op: "cqrs static query",
  name: "composed filters, projection and limit",
  args: [rows],
  jit: activeAdults as (...args: never[]) => unknown,
  competitors: [
    {
      name: "handwritten",
      fn: (value: typeof rows) => {
        const out: { id: string; age: number }[] = [];
        for (let index = 0; index < value.length && out.length < 50; index++) {
          const row = value[index]!;
          if (row.age >= 18 && row.status === "active") out.push({ id: row.id, age: row.age });
        }
        return out;
      },
    },
  ],
});

await runSuite("cqrs");
