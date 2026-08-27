import { JIT } from "../../packages/jit/src/index.js";
import { loadAotArtifacts } from "../shared/aot.js";
import { runSuite } from "../shared/persist.js";
import { registerScenario } from "../shared/scenario.js";

const Order = JIT.object({ id: JIT.number(), customerId: JIT.string(), total: JIT.number() });
type Order = JIT.Typeof<typeof Order>;
const Orders = JIT.array(Order);

const rows: Order[] = Array.from({ length: 10_000 }, (_, index) => ({
  id: index,
  customerId: `customer-${index % 250}`,
  total: (index % 97) + 1,
}));

// What a composite removes is passes, so the comparison is against the same
// answers gathered one reduction at a time.
const composite = JIT.cqrs
  .query(Orders)
  .where((query) => query.gt("total", 10))
  .aggregate({
    count: JIT.cqrs.count(),
    revenue: JIT.cqrs.sum("total"),
    average: JIT.cqrs.avg("total"),
    lowest: JIT.cqrs.min("total"),
    highest: JIT.cqrs.max("total"),
  });

const filtered = () => JIT.cqrs.query(Orders).where((query) => query.gt("total", 10));
const scalarCount = filtered().count();
const scalarSum = filtered().sum("total");
const scalarAvg = filtered().avg("total");
const scalarMin = filtered().min("total");
const scalarMax = filtered().max("total");
const compositeAot = await loadAotArtifacts<{ readonly composite: typeof composite }>({ composite });

registerScenario({
  op: "cqrs-aggregate",
  name: "five reductions / 10000 rows",
  args: [rows],
  jit: composite,
  competitors: [
    { name: "JIT AOT", fn: compositeAot.composite },
    {
      name: "five separate JIT aggregates",
      fn: (value: Order[]) => ({
        count: scalarCount(value),
        revenue: scalarSum(value),
        average: scalarAvg(value),
        lowest: scalarMin(value),
        highest: scalarMax(value),
      }),
    },
    {
      name: "idiomatic filter + reduce chain",
      fn: (value: Order[]) => {
        const matching = value.filter((row) => row.total > 10);
        return {
          count: matching.length,
          revenue: matching.reduce((total, row) => total + row.total, 0),
          average: matching.length === 0 ? undefined : matching.reduce((t, r) => t + r.total, 0) / matching.length,
          lowest: matching.reduce<number | undefined>(
            (low, r) => (low === undefined || r.total < low ? r.total : low),
            undefined
          ),
          highest: matching.reduce<number | undefined>(
            (high, r) => (high === undefined || r.total > high ? r.total : high),
            undefined
          ),
        };
      },
    },
    {
      name: "handwritten one-pass loop",
      fn: (value: Order[]) => {
        let count = 0;
        let revenue = 0;
        let sum = 0;
        let n = 0;
        let lowest: number | undefined;
        let highest: number | undefined;

        for (let i = 0, len = value.length; i < len; i++) {
          const row = value[i];
          if (row.total > 10) {
            count++;
            revenue += row.total;
            sum += row.total;
            n++;
            if (lowest === undefined || row.total < lowest) lowest = row.total;
            if (highest === undefined || row.total > highest) highest = row.total;
          }
        }
        return { count, revenue, average: n === 0 ? undefined : sum / n, lowest, highest };
      },
    },
  ],
});

const twoField = JIT.cqrs
  .query(Orders)
  .where((query) => query.gt("total", 10))
  .aggregate({ count: JIT.cqrs.count(), revenue: JIT.cqrs.sum("total") });
const twoFieldAot = await loadAotArtifacts<{ readonly twoField: typeof twoField }>({ twoField });

registerScenario({
  op: "cqrs-aggregate",
  name: "two reductions / 10000 rows",
  args: [rows],
  jit: twoField,
  competitors: [
    { name: "JIT AOT", fn: twoFieldAot.twoField },
    {
      name: "two separate JIT aggregates",
      fn: (value: Order[]) => ({ count: scalarCount(value), revenue: scalarSum(value) }),
    },
    {
      name: "handwritten one-pass loop",
      fn: (value: Order[]) => {
        let count = 0;
        let revenue = 0;

        for (let i = 0, len = value.length; i < len; i++) {
          const row = value[i];
          if (row.total > 10) {
            count++;
            revenue += row.total;
          }
        }
        return { count, revenue };
      },
    },
  ],
});

// Grouped: the cost that matters is the group arrays a hash aggregate avoids.
const perCustomer = JIT.cqrs
  .query(Orders)
  .groupBy("customerId")
  .aggregate({
    count: JIT.cqrs.count(),
    total: JIT.cqrs.sum("total"),
    lowest: JIT.cqrs.min("total"),
  });
const perCustomerAvg = JIT.cqrs
  .query(Orders)
  .groupBy("customerId")
  .aggregate({
    count: JIT.cqrs.count(),
    average: JIT.cqrs.avg("total"),
  });
const grouped = JIT.cqrs.query(Orders).groupBy("customerId");
const groupedAot = await loadAotArtifacts<{
  readonly perCustomer: typeof perCustomer;
  readonly perCustomerAvg: typeof perCustomerAvg;
}>({ perCustomer, perCustomerAvg });

registerScenario({
  op: "cqrs-aggregate",
  name: "grouped / 10000 rows, 250 groups",
  args: [rows],
  jit: perCustomer,
  competitors: [
    { name: "JIT AOT", fn: groupedAot.perCustomer },
    {
      name: "JIT groupBy then reduce",
      fn: (value: Order[]) =>
        Object.fromEntries(
          Object.entries(grouped(value)).map(([key, group]) => [
            key,
            {
              count: group.length,
              total: group.reduce((sum, order) => sum + order.total, 0),
              lowest: group.reduce<number | undefined>(
                (low, order) => (low === undefined || order.total < low ? order.total : low),
                undefined
              ),
            },
          ])
        ),
    },
    {
      name: "handwritten accumulator map",
      fn: (value: Order[]) => {
        const out: Record<string, { count: number; total: number; lowest: number | undefined }> = Object.create(null);

        for (let i = 0, len = value.length; i < len; i++) {
          const row = value[i];
          let group = out[row.customerId];
          if (group === undefined) {
            group = { count: 0, total: 0, lowest: undefined };
            out[row.customerId] = group;
          }
          group.count++;
          group.total += row.total;
          if (group.lowest === undefined || row.total < group.lowest) group.lowest = row.total;
        }
        return out;
      },
    },
  ],
});

registerScenario({
  op: "cqrs-aggregate",
  name: "grouped with average / 10000 rows, 250 groups",
  args: [rows],
  jit: perCustomerAvg,
  competitors: [
    { name: "JIT AOT", fn: groupedAot.perCustomerAvg },
    {
      name: "JIT groupBy then reduce",
      fn: (value: Order[]) =>
        Object.fromEntries(
          Object.entries(grouped(value)).map(([key, group]) => [
            key,
            { count: group.length, average: group.reduce((sum, order) => sum + order.total, 0) / group.length },
          ])
        ),
    },
  ],
});

await runSuite("cqrs-aggregate");
