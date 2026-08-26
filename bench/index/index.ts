import { emitIndexPlanSource, indexCacheKey } from "../../packages/jit/src/compiler/indexing.js";
import { JIT } from "../../packages/jit/src/index.js";
import { getArtifact } from "../../packages/jit/src/runtime/artifact-registry.js";
import { getCachedIndex } from "../../packages/jit/src/runtime/index/index-cache.js";
import { runSuite } from "../shared/persist.js";
import { registerScenario } from "../shared/scenario.js";

const Row = JIT.object({
  id: JIT.number(),
  tenantId: JIT.string(),
  email: JIT.string(),
  createdAt: JIT.date(),
});
type Row = JIT.Typeof<typeof Row>;
const Rows = JIT.array(Row).keyed("id");

for (const size of [100, 1_000, 10_000, 100_000]) {
  const rows = createRows(size);

  registerBuild(`unique / ${size}`, rows, JIT.index(Rows), (value) => {
    const index = new Map<number, Row>();
    for (let i = 0, len = value.length; i < len; i++) index.set(value[i].id, value[i]);
    return index;
  });
}

const grouped = createRows(10_000);

registerBuild("grouped / 10000 rows, 100 groups", grouped, JIT.index(Rows).by("tenantId").grouped(), (value) => {
  const index = new Map<string, Row[]>();
  for (let i = 0, len = value.length; i < len; i++) {
    const group = index.get(value[i].tenantId);
    if (group === undefined) index.set(value[i].tenantId, [value[i]]);
    else group[group.length] = value[i];
  }
  return index;
});

registerBuild("date key / 10000", grouped, JIT.index(Rows).by("createdAt"), (value) => {
  const index = new Map<number, Row>();
  for (let i = 0, len = value.length; i < len; i++) index.set(value[i].createdAt.getTime(), value[i]);
  return index;
});

registerBuild("compound / 10000", grouped, JIT.index(Rows).by("tenantId", "email"), (value) => {
  const index = new Map<string, Map<string, Row>>();
  for (let i = 0, len = value.length; i < len; i++) {
    const row = value[i];
    let level = index.get(row.tenantId);
    if (level === undefined) {
      level = new Map<string, Row>();
      index.set(row.tenantId, level);
    }
    level.set(row.email, row);
  }
  return index;
});

// What reuse is worth: one lookup against a rebuilt index versus a cached one.
const cachedRows = createRows(10_000);
const cachedPlan = JIT.index(Rows);

registerScenario({
  op: "index",
  name: "lookup / 10000 / reused array",
  args: [cachedRows],
  jit: (value: readonly Row[]) => cachedPlan.cached(value).get(5_000),
  competitors: [
    {
      name: "rebuild per lookup",
      fn: (value: readonly Row[]) => cachedPlan(value).get(5_000),
    },
    {
      name: "linear scan",
      fn: (value: readonly Row[]) => {
        for (let i = 0, len = value.length; i < len; i++) if (value[i].id === 5_000) return value[i];
        return undefined;
      },
      biased: "single lookup favours the scan; the index amortizes over many",
    },
  ],
});

await runSuite("index");

function registerBuild(
  name: string,
  input: readonly Row[],
  plan: (value: readonly Row[]) => unknown,
  handwritten: (value: readonly Row[]) => unknown
) {
  const artifact = getArtifact(plan);

  if (artifact?.kind !== "index-plan") throw new Error(`missing index plan artifact for ${name}`);
  const aot = globalThis.Function(
    `return ${emitIndexPlanSource(artifact.descriptor, indexCacheKey(artifact.descriptor))};`
  )()(getCachedIndex) as (value: readonly Row[]) => unknown;

  registerScenario({
    op: "index",
    name,
    args: [input],
    jit: plan,
    competitors: [
      { name: "handwritten optimized", fn: handwritten },
      { name: "JIT AOT", fn: aot },
    ],
  });
}

function createRows(length: number): Row[] {
  return Array.from({ length }, (_, index) => ({
    id: index,
    tenantId: `tenant-${index % 100}`,
    email: `user-${index}@example.com`,
    createdAt: new Date(1_700_000_000_000 + index * 60_000),
  }));
}
