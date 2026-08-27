import { emitSortSource } from "../../packages/jit/src/compiler/sort.js";
import { JIT } from "../../packages/jit/src/index.js";
import { getArtifact } from "../../packages/jit/src/runtime/artifact-registry.js";
import { runSuite } from "../shared/persist.js";
import { registerScenario } from "../shared/scenario.js";

const Row = JIT.object({
  id: JIT.number(),
  group: JIT.number().brand("Group"),
  short: JIT.string(),
  long: JIT.string(),
  createdAt: JIT.date(),
});
type Row = JIT.Typeof<typeof Row>;
type SortRows = (value: readonly Row[]) => Row[];

const random = createRows(1_000, (index) => (index * 7919) % 1_000);
const sorted = createRows(1_000, (index) => index);
const reverse = createRows(1_000, (index) => 999 - index);
const mostlySorted = createRows(1_000, (index) => (index % 20 === 0 ? Math.min(index + 1, 999) : index));

register("number / random", random, JIT.sort(Row).by("id"), (left, right) => left.id - right.id);
register("number / sorted", sorted, JIT.sort(Row).by("id"), (left, right) => left.id - right.id);
register("number / reverse", reverse, JIT.sort(Row).by("id"), (left, right) => left.id - right.id);
register("number / mostly sorted", mostlySorted, JIT.sort(Row).by("id"), (left, right) => left.id - right.id);
register(
  "Date / random",
  random,
  JIT.sort(Row).by("createdAt"),
  (left, right) => left.createdAt.getTime() - right.createdAt.getTime()
);
register("short string / random", random, JIT.sort(Row).by("short"), (left, right) =>
  left.short < right.short ? -1 : left.short > right.short ? 1 : 0
);
register("long string / random", random, JIT.sort(Row).by("long"), (left, right) =>
  left.long < right.long ? -1 : left.long > right.long ? 1 : 0
);
register("branded scalar / random", random, JIT.sort(Row).by("group"), (left, right) => left.group - right.group);
register(
  "multi-field / random",
  random,
  JIT.sort(Row).by("group").thenBy("createdAt", "desc").thenBy("id"),
  (left, right) =>
    left.group - right.group || right.createdAt.getTime() - left.createdAt.getTime() || left.id - right.id
);

await runSuite("sort");

function register(name: string, input: readonly Row[], runtime: SortRows, compare: (a: Row, b: Row) => number) {
  // The ordering descriptor stays on the artifact record: a compiled plan must
  // not carry it, or AOT output would have to embed a descriptor to match.
  const artifact = getArtifact(runtime);

  if (artifact?.kind !== "sort-plan") throw new Error(`missing sort plan artifact for ${name}`);
  const aot = globalThis.Function(`return ${emitSortSource(artifact.descriptor)};`)() as SortRows;

  registerScenario({
    op: "sort",
    name,
    args: [input],
    jit: runtime,
    competitors: [
      { name: "idiomatic slice.sort", fn: (value: readonly Row[]) => value.slice().sort(compare) },
      {
        name: "handwritten optimized",
        fn: (value: readonly Row[]) => {
          const out = value.slice();
          out.sort(compare);
          return out;
        },
      },
      { name: "JIT AOT", fn: aot },
    ],
  });
}

function createRows(length: number, rank: (index: number) => number): Row[] {
  return Array.from({ length }, (_, index) => {
    const value = rank(index);
    return {
      id: value,
      group: (value % 10) as Row["group"],
      short: String.fromCharCode(65 + (value % 26)),
      long: `tenant-${value % 31}-customer-${String(value).padStart(8, "0")}-event-${value % 17}`,
      createdAt: new Date(1_700_000_000_000 + value * 60_000),
    };
  });
}
