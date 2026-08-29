import { JIT } from "@jit-compiler/jit";
import { loadAotArtifacts } from "../shared/aot.js";
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

const PositionalRows = JIT.array(User);
const positionalState = JIT.state.collection(PositionalRows);
const positional = {
  append: positionalState.append(),
  prepend: positionalState.prepend(),
  insertAt: positionalState.insertAt(),
  removeAt: positionalState.removeAt(),
  replaceAt: positionalState.replaceAt(),
  updateAt: positionalState.updateAt({ patch: { name: JIT.cqrs.param("name") } }),
  swap: positionalState.swap(),
  move: positionalState.move(),
  truncate: positionalState.truncate(),
};
const positionalAot = await loadAotArtifacts<typeof positional>(positional);

function rowsOf(size: number): Row[] {
  return Array.from({ length: size }, (_, index) => ({
    id: `u_${String(index).padStart(7, "0")}`,
    name: `n${index}`,
    score: index,
  }));
}

function insertManual(value: readonly Row[], at: number, row: Row): readonly Row[] {
  const len = value.length;
  const out = new Array<Row>(len + 1);
  for (let index = 0; index < at; index++) out[index] = value[index] as Row;
  out[at] = row;
  for (let index = at; index < len; index++) out[index + 1] = value[index] as Row;
  return out;
}

function removeManual(value: readonly Row[], at: number): readonly Row[] {
  const len = value.length;
  const out = new Array<Row>(len - 1);
  for (let index = 0; index < at; index++) out[index] = value[index] as Row;
  for (let index = at + 1; index < len; index++) out[index - 1] = value[index] as Row;
  return out;
}

function swapManual(value: readonly Row[], a: number, b: number): readonly Row[] {
  if (a === b || value[a] === value[b]) return value;
  const out = value.slice();
  out[a] = value[b] as Row;
  out[b] = value[a] as Row;
  return out;
}

function moveManual(value: readonly Row[], from: number, to: number): readonly Row[] {
  if (from === to) return value;
  const out = new Array<Row>(value.length);
  if (from < to) {
    for (let index = 0; index < from; index++) out[index] = value[index] as Row;
    for (let index = from; index < to; index++) out[index] = value[index + 1] as Row;
  } else {
    for (let index = 0; index < to; index++) out[index] = value[index] as Row;
    for (let index = to + 1; index <= from; index++) out[index] = value[index - 1] as Row;
  }
  out[to] = value[from] as Row;
  const start = Math.max(from, to) + 1;
  for (let index = start; index < value.length; index++) out[index] = value[index] as Row;
  return out;
}

for (const size of [8, 64, 1_000, 10_000, 100_000]) {
  const rows = rowsOf(size);
  const middle = Math.floor(size / 2);
  const row = { id: "inserted", name: "new", score: -1 };
  const changed = { id: rows[middle]?.id ?? "changed", name: "changed", score: middle };

  registerScenario({
    op: `collection append ${size}`,
    name: "positional",
    args: [rows, { row }],
    jit: positional.append as (...args: never[]) => unknown,
    competitors: [
      { name: "spread", fn: (value: readonly Row[]) => [...value, row] },
      { name: "handwritten exact copy", fn: (value: readonly Row[]) => insertManual(value, value.length, row) },
      { name: "JIT AOT", fn: positionalAot.append as (...args: never[]) => unknown },
    ],
  });

  registerScenario({
    op: `collection prepend ${size}`,
    name: "positional",
    args: [rows, { row }],
    jit: positional.prepend as (...args: never[]) => unknown,
    competitors: [
      { name: "spread", fn: (value: readonly Row[]) => [row, ...value] },
      { name: "handwritten exact copy", fn: (value: readonly Row[]) => insertManual(value, 0, row) },
      { name: "JIT AOT", fn: positionalAot.prepend as (...args: never[]) => unknown },
    ],
  });

  registerScenario({
    op: `collection insertAt ${size}`,
    name: "positional",
    args: [rows, { index: middle, row }],
    jit: positional.insertAt as (...args: never[]) => unknown,
    competitors: [
      {
        name: "slice + spread",
        fn: (value: readonly Row[]) => [...value.slice(0, middle), row, ...value.slice(middle)],
      },
      { name: "handwritten exact copy", fn: (value: readonly Row[]) => insertManual(value, middle, row) },
      { name: "JIT AOT", fn: positionalAot.insertAt as (...args: never[]) => unknown },
    ],
  });

  registerScenario({
    op: `collection removeAt ${size}`,
    name: "positional",
    args: [rows, { index: middle }],
    jit: positional.removeAt as (...args: never[]) => unknown,
    competitors: [
      { name: "toSpliced", fn: (value: readonly Row[]) => value.toSpliced(middle, 1) },
      { name: "handwritten exact copy", fn: (value: readonly Row[]) => removeManual(value, middle) },
      { name: "JIT AOT", fn: positionalAot.removeAt as (...args: never[]) => unknown },
    ],
  });

  registerScenario({
    op: `collection replaceAt ${size}`,
    name: "positional",
    args: [rows, { index: middle, row: changed }],
    jit: positional.replaceAt as (...args: never[]) => unknown,
    competitors: [
      {
        name: "slice + assign",
        fn: (value: readonly Row[]) => {
          const out = value.slice();
          out[middle] = changed;
          return out;
        },
      },
      {
        name: "handwritten optimized",
        fn: (value: readonly Row[]) => {
          const current = value[middle] as Row;
          if (current.id === changed.id && current.name === changed.name && current.score === changed.score)
            return value;
          const out = value.slice();
          out[middle] = changed;
          return out;
        },
      },
      { name: "JIT AOT", fn: positionalAot.replaceAt as (...args: never[]) => unknown },
    ],
  });

  registerScenario({
    op: `collection updateAt ${size}`,
    name: "positional",
    args: [rows, { index: middle, name: "changed" }],
    jit: positional.updateAt as (...args: never[]) => unknown,
    competitors: [
      {
        name: "slice + object spread",
        fn: (value: readonly Row[]) => {
          const out = value.slice();
          out[middle] = { ...(value[middle] as Row), name: "changed" };
          return out;
        },
      },
      {
        name: "handwritten optimized",
        fn: (value: readonly Row[]) => {
          const current = value[middle] as Row;
          if (current.name === "changed") return value;
          const out = value.slice();
          out[middle] = { id: current.id, name: "changed", score: current.score };
          return out;
        },
      },
      {
        name: "immer",
        fn: (value: readonly Row[]) =>
          produce(value, (draft) => {
            const current = draft[middle];
            if (current) current.name = "changed";
          }),
      },
      { name: "JIT AOT", fn: positionalAot.updateAt as (...args: never[]) => unknown },
    ],
  });

  registerScenario({
    op: `collection swap ${size}`,
    name: "positional",
    args: [rows, { a: 0, b: size - 1 }],
    jit: positional.swap as (...args: never[]) => unknown,
    competitors: [
      {
        name: "slice + destructure",
        fn: (value: readonly Row[]) => {
          const out = value.slice();
          [out[0], out[size - 1]] = [out[size - 1] as Row, out[0] as Row];
          return out;
        },
      },
      { name: "handwritten optimized", fn: (value: readonly Row[]) => swapManual(value, 0, size - 1) },
      { name: "JIT AOT", fn: positionalAot.swap as (...args: never[]) => unknown },
    ],
  });

  registerScenario({
    op: `collection move ${size}`,
    name: "positional",
    args: [rows, { from: 0, to: size - 1 }],
    jit: positional.move as (...args: never[]) => unknown,
    competitors: [
      {
        name: "slice + splice twice",
        fn: (value: readonly Row[]) => {
          const out = value.slice();
          const [moved] = out.splice(0, 1);
          out.splice(size - 1, 0, moved as Row);
          return out;
        },
      },
      { name: "handwritten range copy", fn: (value: readonly Row[]) => moveManual(value, 0, size - 1) },
      { name: "JIT AOT", fn: positionalAot.move as (...args: never[]) => unknown },
    ],
  });

  registerScenario({
    op: `collection truncate ${size}`,
    name: "positional",
    args: [rows, { length: middle }],
    jit: positional.truncate as (...args: never[]) => unknown,
    competitors: [
      { name: "slice", fn: (value: readonly Row[]) => value.slice(0, middle) },
      {
        name: "handwritten exact copy",
        fn: (value: readonly Row[]) => {
          const out = new Array<Row>(middle);
          for (let index = 0; index < middle; index++) out[index] = value[index] as Row;
          return out;
        },
      },
      { name: "JIT AOT", fn: positionalAot.truncate as (...args: never[]) => unknown },
    ],
  });
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
