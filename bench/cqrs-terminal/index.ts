import { JIT } from "../../packages/jit/src/index.js";
import { runSuite } from "../shared/persist.js";
import { registerScenario } from "../shared/scenario.js";

const Row = JIT.object({
  id: JIT.number(),
  tenantId: JIT.string(),
  active: JIT.boolean(),
});
type Row = JIT.Typeof<typeof Row>;
const Rows = JIT.array(Row);

const rows: Row[] = Array.from({ length: 10_000 }, (_, index) => ({
  id: index,
  tenantId: `tenant-${index % 100}`,
  active: index % 2 === 0,
}));

// Where the match sits decides everything: an early exit is only worth what it
// skips, so the same query is measured at the front, middle and end.
//
// The sub-microsecond rows (a match at row 0) are below this harness's useful
// resolution: every implementation returns almost immediately and what is left
// is call dispatch, which the harness shares across the registered scenarios.
// Read the middle/last/no-match rows for the comparison that means something.
for (const [position, target] of [
  ["first row", 0],
  ["middle row", 5_000],
  ["last row", 9_999],
  ["no match", -1],
] as const) {
  const first = JIT.cqrs
    .query(Rows)
    .where((query) => query.eq("id", target))
    .first();
  const collectThenTake = JIT.cqrs.query(Rows).where((query) => query.eq("id", target));

  registerScenario({
    op: "cqrs-terminal",
    name: `first / ${position}`,
    args: [rows],
    jit: first,
    competitors: [
      { name: "idiomatic find", fn: (value: readonly Row[]) => value.find((row) => row.id === target) },
      {
        name: "handwritten loop",
        fn: (value: readonly Row[]) => {
          for (let i = 0, len = value.length; i < len; i++) if (value[i].id === target) return value[i];
          return undefined;
        },
      },
      {
        name: "JIT filter then [0]",
        fn: (value: readonly Row[]) => collectThenTake(value as Row[])[0],
        biased: "collects every match before taking one; shown as the cost first() removes",
      },
    ],
  });
}

const anyInactive = JIT.cqrs
  .query(Rows)
  .where((query) => query.eq("active", false))
  .some();
const allPositive = JIT.cqrs
  .query(Rows)
  .where((query) => query.gte("id", 0))
  .every();
const countInactive = JIT.cqrs
  .query(Rows)
  .where((query) => query.eq("active", false))
  .count();

registerScenario({
  op: "cqrs-terminal",
  name: "some / match at row 1",
  args: [rows],
  jit: anyInactive,
  competitors: [
    { name: "idiomatic some", fn: (value: readonly Row[]) => value.some((row) => !row.active) },
    {
      name: "JIT count() > 0",
      fn: (value: readonly Row[]) => countInactive(value as Row[]) > 0,
      biased: "counts every match; shown as the cost some() removes",
    },
  ],
});

registerScenario({
  op: "cqrs-terminal",
  name: "every / all match",
  args: [rows],
  jit: allPositive,
  competitors: [{ name: "idiomatic every", fn: (value: readonly Row[]) => value.every((row) => row.id >= 0) }],
});

await runSuite("cqrs-terminal");
