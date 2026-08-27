import { JIT } from "../../packages/jit/src/index.js";
import { loadAotArtifacts } from "../shared/aot.js";
import { runSuite } from "../shared/persist.js";
import { registerScenario } from "../shared/scenario.js";

/**
 * The same declaration, three access paths. Only the collection's facts
 * differ, so what is measured is the planner's choice and nothing else.
 */

const User = JIT.object({ id: JIT.number(), email: JIT.string(), score: JIT.number() });
type User = JIT.Typeof<typeof User>;

const Plain = JIT.array(User);
const Keyed = JIT.array(User).keyed("id");
const Ordered = JIT.array(User).ordered("id", "asc").uniqueBy("id");

const scan = JIT.cqrs
  .query(Plain)
  .params({ id: JIT.number() })
  .where((query, params) => query.eq("id", params.id))
  .first();
const indexed = JIT.cqrs
  .query(Keyed)
  .params({ id: JIT.number() })
  .where((query, params) => query.eq("id", params.id))
  .first();
const binary = JIT.cqrs
  .query(Ordered)
  .params({ id: JIT.number() })
  .where((query, params) => query.eq("id", params.id))
  .first();
const aot = await loadAotArtifacts<{
  readonly scan: typeof scan;
  readonly indexed: typeof indexed;
  readonly binary: typeof binary;
}>({ scan, indexed, binary });

for (const size of [1_000, 10_000, 100_000]) {
  const rows: User[] = Array.from({ length: size }, (_, index) => ({
    id: index,
    email: `user-${index}@example.com`,
    score: index % 97,
  }));
  // The middle row: a scan's average case, and where the access paths differ
  // most from a lucky early exit.
  const target = size >> 1;
  const handwrittenIndex = new Map(rows.map((row) => [row.id, row]));

  registerScenario({
    op: "cqrs-physical",
    name: `eq unique key / ${size} rows`,
    args: [rows, { id: target }],
    jit: indexed,
    competitors: [
      { name: "JIT AOT CachedIndexLookup", fn: aot.indexed },
      { name: "JIT EarlyExitScan", fn: (value: User[], params: { id: number }) => scan(value, params) },
      { name: "JIT AOT EarlyExitScan", fn: aot.scan },
      { name: "JIT BinarySearch", fn: (value: User[], params: { id: number }) => binary(value, params) },
      { name: "JIT AOT BinarySearch", fn: aot.binary },
      {
        name: "idiomatic find",
        fn: (value: User[], params: { id: number }) => value.find((row) => row.id === params.id),
      },
      {
        name: "handwritten Map (prebuilt)",
        fn: (_value: User[], params: { id: number }) => handwrittenIndex.get(params.id),
        biased: "the map is built outside the measurement; it is the ceiling a cached index aims at",
      },
    ],
  });
}

// Building the index has to be paid once. This is what that first call costs.
const coldRows: User[] = Array.from({ length: 10_000 }, (_, index) => ({
  id: index,
  email: `user-${index}@example.com`,
  score: index % 97,
}));

registerScenario({
  op: "cqrs-physical",
  name: "eq unique key / 10000 rows / cold array each call",
  args: [coldRows],
  jit: (value: User[]) => indexed(value.slice(), { id: 5_000 }),
  competitors: [
    { name: "JIT AOT CachedIndexLookup", fn: (value: User[]) => aot.indexed(value.slice(), { id: 5_000 }) },
    { name: "JIT EarlyExitScan", fn: (value: User[]) => scan(value.slice(), { id: 5_000 }) },
    { name: "JIT AOT EarlyExitScan", fn: (value: User[]) => aot.scan(value.slice(), { id: 5_000 }) },
    { name: "JIT BinarySearch", fn: (value: User[]) => binary(value.slice(), { id: 5_000 }) },
    { name: "JIT AOT BinarySearch", fn: (value: User[]) => aot.binary(value.slice(), { id: 5_000 }) },
  ],
});

await runSuite("cqrs-physical");
