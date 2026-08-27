import { Compiler, JIT } from "../../packages/jit/src/index.js";
import { getArtifact } from "../../packages/jit/src/runtime/artifact-registry.js";
import { getCachedIndex } from "../../packages/jit/src/runtime/index/index-cache.js";
import { runSuite } from "../shared/persist.js";
import { registerScenario } from "../shared/scenario.js";

const Row = JIT.object({
  id: JIT.number(),
  name: JIT.string(),
});
type Row = JIT.Typeof<typeof Row>;

const SIZE = 100_000;
const rows: Row[] = Array.from({ length: SIZE }, (_, index) => ({ id: index, name: `user-${index}` }));

/**
 * The lookups are spread across the whole array so no single scenario is
 * decided by where one probe happens to land. A scan pays for the average
 * position; an index and a binary search do not.
 */
const probes = Array.from({ length: 64 }, (_, index) => Math.floor((index * SIZE) / 64));

function sweep(lookup: (value: readonly Row[], key: number) => Row | undefined) {
  return (value: readonly Row[]) => {
    let found = 0;
    for (let i = 0, len = probes.length; i < len; i++) if (lookup(value, probes[i] as number) !== undefined) found++;
    return found;
  };
}

/** Re-emits what AOT writes for this plan, bound the way the generated module binds it. */
function aotOf(plan: object): (value: readonly Row[], key: number) => Row | undefined {
  const artifact = getArtifact(plan);

  if (artifact?.kind !== "lookup-plan") throw new Error("lookup benchmark requires a LookupPlan");
  return globalThis.Function(
    "__cachedIndex",
    `return ${Compiler.emitLookupSource(artifact.lookup)};`
  )(getCachedIndex) as (value: readonly Row[], key: number) => Row | undefined;
}

// --------------------------------------------------------------- scan (no fact)

const scanPlan = JIT.lookup(JIT.array(Row)).by("id");

registerScenario({
  op: "lookup",
  name: `scan / no key fact / ${SIZE} rows / 64 probes`,
  args: [rows],
  jit: sweep(scanPlan),
  competitors: [
    { name: "JIT AOT", fn: sweep(aotOf(scanPlan)) },
    {
      name: "handwritten optimized",
      fn: sweep((value, key) => {
        for (let i = 0, len = value.length; i < len; i++) {
          const row = value[i] as Row;
          if (row.id === key) return row;
        }
        return undefined;
      }),
    },
    { name: "idiomatic JS", fn: sweep((value, key) => value.find((row) => row.id === key)) },
  ],
});

// ------------------------------------------------------------- cached index

const keyedPlan = JIT.lookup(JIT.array(Row).keyed("id"));
const handwrittenIndex = new Map<number, Row>();
for (let i = 0; i < rows.length; i++) handwrittenIndex.set((rows[i] as Row).id, rows[i] as Row);

registerScenario({
  op: "lookup",
  name: `cached index / keyed / ${SIZE} rows / 64 probes`,
  args: [rows],
  jit: sweep(keyedPlan),
  competitors: [
    { name: "JIT AOT", fn: sweep(aotOf(keyedPlan)) },
    {
      name: "handwritten optimized",
      fn: sweep((_value, key) => handwrittenIndex.get(key)),
      biased: "the handwritten Map is built once outside the measurement; JIT builds it on first call",
    },
    { name: "idiomatic JS", fn: sweep((value, key) => value.find((row) => row.id === key)) },
  ],
});

// ------------------------------------------------------------ binary search

const orderedPlan = JIT.lookup(JIT.array(Row).ordered("id", "asc").uniqueBy("id"));

registerScenario({
  op: "lookup",
  name: `binary search / ordered unique / ${SIZE} rows / 64 probes`,
  args: [rows],
  jit: sweep(orderedPlan),
  competitors: [
    { name: "JIT AOT", fn: sweep(aotOf(orderedPlan)) },
    {
      name: "handwritten optimized",
      fn: sweep((value, key) => {
        let low = 0;
        let high = value.length - 1;
        while (low <= high) {
          const mid = (low + high) >>> 1;
          const row = value[mid] as Row;
          if (row.id === key) return row;
          if (row.id < key) low = mid + 1;
          else high = mid - 1;
        }
        return undefined;
      }),
    },
    { name: "idiomatic JS", fn: sweep((value, key) => value.find((row) => row.id === key)) },
  ],
});

await runSuite("lookup");
