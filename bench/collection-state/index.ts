import { JIT } from "@jit-compiler/jit";
import { produce } from "../shared/competitors.js";
import { runSuite } from "../shared/persist.js";
import { registerScenario } from "../shared/scenario.js";

/**
 * Immutable collection mutation, against what it replaces.
 *
 * The point is not that copying an array is cheap — it is O(n) whatever finds
 * the row. The point is how much work reaching the row costs, and how much of
 * the collection has to be visited before the copy can start.
 */
const User = JIT.object({ id: JIT.string(), name: JIT.string(), score: JIT.number() });
const Plain = JIT.array(User);
const Keyed = JIT.array(User).keyed("id");
const Ordered = JIT.array(User).ordered("id").uniqueBy("id");

type Row = { id: string; name: string; score: number };

function rowsOf(size: number): Row[] {
  return Array.from({ length: size }, (_, index) => ({
    id: `u_${String(index).padStart(7, "0")}`,
    name: `n${index}`,
    score: index,
  }));
}

for (const size of [100, 1_000, 10_000, 100_000]) {
  const rows = rowsOf(size);
  const target = `u_${String(Math.floor(size / 2)).padStart(7, "0")}`;
  const patch = { patch: { name: JIT.cqrs.param("name") }, key: "id" } as const;
  const scan = JIT.state.collection(Plain).updateByKey(patch);
  const indexed = JIT.state.collection(Keyed).updateByKey(patch);
  const binary = JIT.state.collection(Ordered).updateByKey(patch);
  const params = { key: target, name: "changed" };

  registerScenario({
    op: `collection updateByKey ${size}`,
    name: "scan (no declared fact)",
    args: [rows, params],
    jit: scan as (...args: never[]) => unknown,
    competitors: [
      {
        name: "findIndex + slice",
        fn: (value: readonly Row[]) => {
          const at = value.findIndex((row) => row.id === target);
          if (at < 0) return value;
          const out = value.slice();
          out[at] = { ...(value[at] as Row), name: "changed" };
          return out;
        },
      },
      {
        name: "map",
        fn: (value: readonly Row[]) => value.map((row) => (row.id === target ? { ...row, name: "changed" } : row)),
      },
      {
        name: "immer",
        fn: (value: readonly Row[]) =>
          produce(value, (draft) => {
            const row = draft.find((item) => item.id === target);
            if (row) row.name = "changed";
          }),
      },
    ],
  });

  registerScenario({
    op: `collection updateByKey ${size}`,
    name: "cached index (keyed)",
    args: [rows, params],
    jit: indexed as (...args: never[]) => unknown,
    competitors: [
      {
        name: "handwritten Map index",
        fn: (() => {
          const positions = new Map(rows.map((row, index) => [row.id, index]));
          return (value: readonly Row[]) => {
            const at = positions.get(target);
            if (at === undefined) return value;
            const out = value.slice();
            out[at] = { ...(value[at] as Row), name: "changed" };
            return out;
          };
        })(),
        biased: "the index is built outside the measurement and is never invalidated",
      },
    ],
  });

  registerScenario({
    op: `collection updateByKey ${size}`,
    name: "binary search (ordered)",
    args: [rows, params],
    jit: binary as (...args: never[]) => unknown,
    competitors: [],
  });

  const removeScan = JIT.state.collection(Plain).removeByKey({ key: "id" });
  const removeIndexed = JIT.state.collection(Keyed).removeByKey({ key: "id" });

  registerScenario({
    op: `collection removeByKey ${size}`,
    name: "scan (no declared fact)",
    args: [rows, { key: target }],
    jit: removeScan as (...args: never[]) => unknown,
    competitors: [
      { name: "filter", fn: (value: readonly Row[]) => value.filter((row) => row.id !== target) },
      {
        name: "findIndex + toSpliced",
        fn: (value: readonly Row[]) => {
          const at = value.findIndex((row) => row.id === target);
          return at < 0 ? value : value.toSpliced(at, 1);
        },
      },
    ],
  });

  registerScenario({
    op: `collection removeByKey ${size}`,
    name: "cached index (keyed)",
    args: [rows, { key: target }],
    jit: removeIndexed as (...args: never[]) => unknown,
    competitors: [],
  });

  const upsertOrdered = JIT.state.collection(Ordered).upsert({ key: "id" });
  const inserted = { id: "u_0000000x", name: "new", score: -1 };

  registerScenario({
    op: `collection upsert ${size}`,
    name: "ordered insertion",
    args: [rows, { key: inserted.id, row: inserted }],
    jit: upsertOrdered as (...args: never[]) => unknown,
    competitors: [
      {
        name: "concat + sort",
        fn: (value: readonly Row[]) => [...value, inserted].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
      },
    ],
  });
}

await runSuite("collection-state");
