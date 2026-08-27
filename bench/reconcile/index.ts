import { Compiler, JIT } from "../../packages/jit/src/index.js";
import { getArtifact } from "../../packages/jit/src/runtime/artifact-registry.js";
import { runSuite } from "../shared/persist.js";
import { type Competitor, registerScenario } from "../shared/scenario.js";

const Row = JIT.object({
  id: JIT.number(),
  name: JIT.string(),
  score: JIT.number(),
});
type Row = JIT.Typeof<typeof Row>;
const Rows = JIT.array(Row).keyed("id");

function make(size: number): Row[] {
  return Array.from({ length: size }, (_, index) => ({ id: index, name: `user-${index}`, score: index }));
}

/** A fresh snapshot: same identities, all-new references, `ratio` of them actually changed. */
function next(previous: readonly Row[], ratio: number): Row[] {
  const every = ratio === 0 ? Number.POSITIVE_INFINITY : Math.round(1 / ratio);
  return previous.map((row, index) =>
    index % every === 0 ? { ...row, name: `${row.name}!` } : { id: row.id, name: row.name, score: row.score }
  );
}

/** Re-emits what AOT writes for this plan, bound the way the generated module binds it. */
function aotOf(plan: object): (previous: readonly Row[], current: readonly Row[]) => unknown {
  const artifact = getArtifact(plan);

  if (artifact?.kind !== "reconcile-plan") throw new Error("reconcile benchmark requires a ReconcilePlan");
  return globalThis.Function(
    "__reconcileEqual",
    "__reconcileDiff",
    `return ${Compiler.emitReconcileSource(artifact.descriptor)};`
  )(JIT.compare.equal(Row), JIT.compare.diff(Row)) as (previous: readonly Row[], current: readonly Row[]) => unknown;
}

const equalRow = JIT.compare.equal(Row);

/** The shape the plan calls out: a nested scan, which is what naive code does. */
function nestedFind(previous: readonly Row[], current: readonly Row[]) {
  const added: Row[] = [];
  const changed: { before: Row; after: Row }[] = [];
  const unchanged: Row[] = [];
  for (const row of current) {
    const before = previous.find((candidate) => candidate.id === row.id);
    if (before === undefined) added.push(row);
    else if (equalRow(before, row)) unchanged.push(row);
    else changed.push({ before, after: row });
  }
  const removed = previous.filter((row) => !current.some((candidate) => candidate.id === row.id));
  return { added, removed, changed, unchanged };
}

/** The ceiling: what a careful engineer writes by hand for this exact shape. */
function handwritten(previous: readonly Row[], current: readonly Row[]) {
  const index = new Map<number, Row>();
  for (let i = 0, len = previous.length; i < len; i++) {
    const row = previous[i] as Row;
    index.set(row.id, row);
  }
  const added: Row[] = [];
  const changed: { before: Row; after: Row }[] = [];
  const unchanged: Row[] = [];
  for (let i = 0, len = current.length; i < len; i++) {
    const row = current[i] as Row;
    const before = index.get(row.id);
    if (before === undefined) {
      added[added.length] = row;
    } else {
      index.delete(row.id);
      if (before === row || (before.id === row.id && before.name === row.name && before.score === row.score)) {
        unchanged[unchanged.length] = row;
      } else {
        changed[changed.length] = { before, after: row };
      }
    }
  }
  const removed: Row[] = [];
  for (const row of index.values()) removed[removed.length] = row;
  return { added, removed, changed, unchanged };
}

const plan = JIT.reconcile(Rows);
const aot = aotOf(plan);

// The nested scan is quadratic, so it only runs where it can still finish.
for (const size of [100, 1_000, 10_000, 100_000] as const) {
  const previous = make(size);

  for (const ratio of [0, 0.01, 0.1, 0.5, 1] as const) {
    const current = next(previous, ratio);
    const competitors: Competitor[] = [
      { name: "JIT AOT", fn: (left: readonly Row[]) => aot(left, current) },
      { name: "handwritten optimized", fn: (left: readonly Row[]) => handwritten(left, current) },
    ];

    if (size <= 1_000) {
      competitors.push({
        name: "nested find",
        fn: (left: readonly Row[]) => nestedFind(left, current),
        biased: "quadratic by construction; it is the shape being replaced, not a fair rival",
      });
    }

    registerScenario({
      op: "reconcile",
      name: `${size} rows / ${ratio * 100}% changed`,
      args: [previous],
      jit: (left: readonly Row[]) => plan(left, current),
      competitors,
    });
  }
}

// Identity-heavy shapes: everything added, everything removed, and same refs.
const base = make(10_000);

registerScenario({
  op: "reconcile",
  name: "10000 rows / same references",
  args: [base],
  jit: (left: readonly Row[]) => plan(left, base),
  competitors: [
    { name: "JIT AOT", fn: (left: readonly Row[]) => aot(left, base) },
    { name: "handwritten optimized", fn: (left: readonly Row[]) => handwritten(left, base) },
  ],
});

const disjoint = make(10_000).map((row) => ({ ...row, id: row.id + 1_000_000 }));

registerScenario({
  op: "reconcile",
  name: "10000 rows / added-heavy and removed-heavy",
  args: [base],
  jit: (left: readonly Row[]) => plan(left, disjoint),
  competitors: [
    { name: "JIT AOT", fn: (left: readonly Row[]) => aot(left, disjoint) },
    { name: "handwritten optimized", fn: (left: readonly Row[]) => handwritten(left, disjoint) },
  ],
});

// What narrowing the request is worth: the same data, only additions wanted.
const addedOnly = JIT.reconcile(Rows, { removed: false, changed: false, unchanged: false });
const halfChanged = next(base, 0.5);

registerScenario({
  op: "reconcile",
  name: "10000 rows / added channel only",
  args: [base],
  jit: (left: readonly Row[]) => addedOnly(left, halfChanged),
  competitors: [
    { name: "all four channels", fn: (left: readonly Row[]) => plan(left, halfChanged) },
    { name: "handwritten optimized [all channels]", fn: (left: readonly Row[]) => handwritten(left, halfChanged) },
  ],
});

// A visitor answers the same question while materializing nothing.
const visit = JIT.reconcile(Rows).to.visitor();

registerScenario({
  op: "reconcile",
  name: "10000 rows / visitor sink, 50% changed",
  args: [base],
  jit: (left: readonly Row[]) => {
    let seen = 0;
    visit(left, halfChanged, { added: () => seen++, removed: () => seen++, changed: () => seen++ });
    return seen;
  },
  competitors: [{ name: "eager result", fn: (left: readonly Row[]) => plan(left, halfChanged) }],
});

await runSuite("reconcile");
