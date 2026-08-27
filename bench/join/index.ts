import { Compiler, JIT } from "../../packages/jit/src/index.js";
import { getArtifact } from "../../packages/jit/src/runtime/artifact-registry.js";
import { getCachedIndex } from "../../packages/jit/src/runtime/index/index-cache.js";
import { runSuite } from "../shared/persist.js";
import { registerScenario } from "../shared/scenario.js";

const Order = JIT.object({ id: JIT.number(), customerId: JIT.number(), total: JIT.number() });
const Customer = JIT.object({ id: JIT.number(), name: JIT.string() });
type Order = JIT.Typeof<typeof Order>;
type Customer = JIT.Typeof<typeof Customer>;
type Pair = { readonly left: Order; readonly right: Customer };

function data(leftSize: number, rightSize: number): readonly [Order[], Customer[]] {
  const right = Array.from({ length: rightSize }, (_, id) => ({ id, name: `customer-${id}` }));
  const left = Array.from({ length: leftSize }, (_, id) => ({ id, customerId: id % (rightSize * 2), total: id % 100 }));
  return [left, right];
}

function handwritten(left: readonly Order[], right: readonly Customer[]): Pair[] {
  const index = new Map<number, Customer>();
  for (let i = 0, len = right.length; i < len; i++) index.set(right[i].id, right[i]);
  const out = new Array<Pair>(left.length);
  let k = 0;
  for (let i = 0, len = left.length; i < len; i++) {
    const leftRow = left[i];
    const rightRow = index.get(leftRow.customerId);
    if (rightRow !== undefined) out[k++] = { left: leftRow, right: rightRow };
  }
  out.length = k;
  return out;
}

function nested(left: readonly Order[], right: readonly Customer[]): Pair[] {
  const out: Pair[] = [];
  for (const leftRow of left) {
    const rightRow = right.find((candidate) => candidate.id === leftRow.customerId);
    if (rightRow !== undefined) out.push({ left: leftRow, right: rightRow });
  }
  return out;
}

function handwrittenMerge(left: readonly Order[], right: readonly Customer[]): Pair[] {
  const out = new Array<Pair>(left.length);
  let i = 0;
  let j = 0;
  let k = 0;
  while (i < left.length && j < right.length) {
    const leftRow = left[i];
    const rightRow = right[j];
    if (leftRow.customerId < rightRow.id) i++;
    else if (leftRow.customerId > rightRow.id) j++;
    else {
      out[k++] = { left: leftRow, right: rightRow };
      i++;
    }
  }
  out.length = k;
  return out;
}

function aotOf(value: object): (left: readonly Order[], right: readonly Customer[]) => Pair[] {
  const artifact = getArtifact(value);
  if (artifact?.kind !== "join-plan") throw new Error("join benchmark requires a JoinPlan");
  const source = Compiler.emitJoinSource(artifact.plan);
  return globalThis.Function("__cachedIndex", `return ${source};`)(getCachedIndex) as (
    left: readonly Order[],
    right: readonly Customer[]
  ) => Pair[];
}

for (const [leftSize, rightSize] of [
  [1_000, 1_000],
  [10_000, 10_000],
  [10_000, 1_000],
] as const) {
  const [left, right] = data(leftSize, rightSize);
  const runtime = JIT.cqrs.query(Order).join(JIT.array(Customer).uniqueBy("id")).on("customerId", "id");
  const aot = aotOf(runtime);

  registerScenario({
    op: "join",
    name: `inner unique / ${leftSize} left / ${rightSize} right`,
    args: [left, right],
    jit: runtime,
    competitors: [
      { name: "JIT AOT", fn: aot },
      { name: "handwritten hash join", fn: handwritten },
      {
        name: "nested find",
        fn: nested,
        biased: "O(n*m) reference retained to show the algorithmic gap, not as a like-for-like ceiling",
      },
    ],
  });
}

// Reuse is measured separately: the right reference is stable and `.keyed`
// opts into the shared WeakMap cache. The first untimed verification builds it.
{
  const [left, right] = data(10_000, 10_000);
  const runtime = JIT.cqrs.query(Order).join(JIT.array(Customer).keyed("id")).on("customerId", "id");
  const aot = aotOf(runtime);
  runtime(left, right);
  aot(left, right);
  registerScenario({
    op: "join",
    name: "cached indexed / 10000 left / 10000 right",
    args: [left, right],
    jit: runtime,
    competitors: [
      { name: "JIT AOT", fn: aot },
      { name: "handwritten rebuild", fn: handwritten },
    ],
  });
}

// Ordered unique inputs are the MergeJoin gate. `customerId` is monotonic and
// each left row has at most one right row, so the ceiling needs no buckets.
{
  const right: Customer[] = Array.from({ length: 10_000 }, (_, id) => ({ id, name: `customer-${id}` }));
  const left: Order[] = Array.from({ length: 10_000 }, (_, id) => ({ id, customerId: id, total: id % 100 }));
  const merge = JIT.cqrs
    .query(JIT.array(Order).ordered("customerId", "asc"))
    .join(JIT.array(Customer).ordered("id", "asc").uniqueBy("id"))
    .on("customerId", "id");
  const aot = aotOf(merge);
  registerScenario({
    op: "join",
    name: "merge ceiling / ordered unique 10000 x 10000",
    args: [left, right],
    jit: merge,
    competitors: [
      { name: "JIT AOT", fn: aot },
      { name: "handwritten hash join", fn: handwritten },
      { name: "handwritten merge join", fn: handwrittenMerge },
    ],
  });
}

await runSuite("join");
