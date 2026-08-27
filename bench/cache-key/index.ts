import { JIT } from "../../packages/jit/src/index.js";
import { loadAotArtifacts } from "../shared/aot.js";
import { runSuite } from "../shared/persist.js";
import { registerScenario } from "../shared/scenario.js";

const Row = JIT.object({
  tenantId: JIT.string(),
  id: JIT.number(),
  version: JIT.number(),
  email: JIT.string(),
  notes: JIT.string(),
  score: JIT.number(),
});
type Row = JIT.Typeof<typeof Row>;

const rows: Row[] = Array.from({ length: 10_000 }, (_, index) => ({
  tenantId: `tenant-${index % 32}`,
  id: index,
  version: index % 7,
  email: `user-${index}@example.com`,
  notes: `note-${index}`,
  score: index,
}));

const keyString = JIT.cacheKey.string(Row).select("tenantId", "id", "version");
const keyHash = JIT.cacheKey.hash(Row).select("tenantId", "id", "version");
const aot = await loadAotArtifacts<{
  readonly keyString: typeof keyString;
  readonly keyHash: typeof keyHash;
}>({ keyString, keyHash });

/** Keys are retained, which is what a cache does with them. */
const sweep =
  <TKey>(fn: (row: Row) => TKey) =>
  (input: readonly Row[]) => {
    const out = new Array<TKey>(input.length);
    for (let i = 0, len = input.length; i < len; i++) out[i] = fn(input[i] as Row);
    return out;
  };

registerScenario({
  op: "cache-key",
  name: "string key from 3 of 6 fields / 10000 rows",
  args: [rows],
  jit: sweep(keyString),
  competitors: [
    { name: "JIT AOT", fn: sweep(aot.keyString) },
    {
      name: "JSON.stringify of a picked object",
      fn: sweep((row) => JSON.stringify({ tenantId: row.tenantId, id: row.id, version: row.version })),
    },
    {
      name: "JSON.stringify of an array",
      fn: sweep((row) => JSON.stringify([row.tenantId, row.id, row.version])),
    },
    {
      name: "handwritten template literal",
      fn: sweep((row) => `${row.tenantId}${row.id}${row.version}`),
    },
  ],
});

registerScenario({
  op: "cache-key",
  name: "numeric key from 3 of 6 fields / 10000 rows",
  args: [rows],
  jit: sweep(keyHash),
  competitors: [
    { name: "JIT AOT", fn: sweep(aot.keyHash) },
    {
      name: "string key",
      fn: sweep(keyString),
      biased: "a string key is a different product; it is readable and stable across processes",
    },
    {
      name: "JSON.stringify of a picked object",
      fn: sweep((row) => JSON.stringify({ tenantId: row.tenantId, id: row.id, version: row.version })),
    },
  ],
});

await runSuite("cache-key");
