import { Compiler, JIT } from "../../packages/jit/src/index.js";
import { runSuite } from "../shared/persist.js";
import { registerScenario } from "../shared/scenario.js";

const Row = JIT.object({
  tenant: JIT.number(),
  id: JIT.number(),
  name: JIT.string(),
});
type Row = JIT.Typeof<typeof Row>;

const rows: Row[] = Array.from({ length: 100_000 }, (_, index) => ({
  tenant: index % 16,
  id: index % 50_000,
  name: `user-${index % 50_000}`,
}));
const orderedRows = [...rows].sort((left, right) => left.id - right.id);

function scalarSet(input: readonly Row[]): Row[] {
  const seen = new Set<number>();
  const out = new Array<Row>(input.length);
  let j = 0;
  for (let i = 0, len = input.length; i < len; i++) {
    const item = input[i];
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    out[j++] = item;
  }
  out.length = j;
  return out;
}

function compoundTrie(input: readonly Row[]): Row[] {
  const root = new Map<number, Set<number>>();
  const out = new Array<Row>(input.length);
  let j = 0;
  for (let i = 0, len = input.length; i < len; i++) {
    const item = input[i];
    let ids = root.get(item.tenant);
    if (ids === undefined) {
      ids = new Set<number>();
      root.set(item.tenant, ids);
    }
    if (ids.has(item.id)) continue;
    ids.add(item.id);
    out[j++] = item;
  }
  out.length = j;
  return out;
}

function structuralJson(input: readonly Row[]): Row[] {
  const seen = new Set<string>();
  const out: Row[] = [];
  for (const item of input) {
    const key = JSON.stringify(item);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

function aot(fields: readonly string[], ordered = false): (input: readonly Row[]) => Row[] {
  const schema = ordered ? JIT.array(Row).ordered("id", "asc").schema : JIT.array(Row).schema;
  const source = Compiler.emitQuerySource(schema, {
    nodes: [{ kind: "distinct", fields }],
    bindings: [],
  });
  // AOT emits an uncached hash for distinct: a query may not inherit a hash
  // memoized for a row that was mutated between calls. Binding the cached
  // public hash here would measure code AOT never emits.
  return globalThis.Function(
    "__distinctHash",
    "__distinctEqual",
    `return ${source};`
  )(Compiler.compileUncachedHash(Row.schema), JIT.compare.equal(Row)) as (input: readonly Row[]) => Row[];
}

for (const scenario of [
  {
    name: "scalar Set / 100000 rows / 50% duplicate",
    input: rows,
    runtime: JIT.cqrs.query(Row).distinct("id"),
    emitted: aot(["id"]),
    ceiling: scalarSet,
    baseline: (input: readonly Row[]) => [...new Map(input.map((item) => [item.id, item])).values()],
  },
  {
    name: "ordered adjacent / 100000 rows / 50% duplicate",
    input: orderedRows,
    runtime: JIT.cqrs.query(JIT.array(Row).ordered("id", "asc")).distinct("id"),
    emitted: aot(["id"], true),
    ceiling: (input: readonly Row[]) => {
      const out = new Array<Row>(input.length);
      let j = 0;
      let previous = -1;
      for (let i = 0, len = input.length; i < len; i++) {
        const item = input[i];
        if (i !== 0 && item.id === previous) continue;
        previous = item.id;
        out[j++] = item;
      }
      out.length = j;
      return out;
    },
    baseline: scalarSet,
  },
  {
    name: "compound trie / 100000 rows",
    input: rows,
    runtime: JIT.cqrs.query(Row).distinct("tenant", "id"),
    emitted: aot(["tenant", "id"]),
    ceiling: compoundTrie,
    baseline: (input: readonly Row[]) => {
      const seen = new Set<string>();
      return input.filter((item) => {
        const key = `${item.tenant}:${item.id}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    },
  },
  {
    name: "structural hash / 100000 rows / 50% duplicate",
    input: rows,
    runtime: JIT.cqrs.query(Row).distinct(),
    emitted: aot([]),
    ceiling: structuralJson,
    baseline: (input: readonly Row[]) => [...new Map(input.map((item) => [JSON.stringify(item), item])).values()],
  },
] as const) {
  registerScenario({
    op: "distinct",
    name: scenario.name,
    args: [scenario.input],
    jit: scenario.runtime,
    competitors: [
      { name: "JIT AOT", fn: scenario.emitted },
      { name: "handwritten optimized", fn: scenario.ceiling },
      { name: "idiomatic JS", fn: scenario.baseline },
    ],
  });
}

await runSuite("distinct");
