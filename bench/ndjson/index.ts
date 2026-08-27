import { JIT } from "../../packages/jit/src/index.js";
import { loadAotArtifacts } from "../shared/aot.js";
import { runSuite } from "../shared/persist.js";
import { registerScenario } from "../shared/scenario.js";

const Row = JIT.object({ id: JIT.number().int(), name: JIT.string(), active: JIT.boolean() });
type Row = JIT.Typeof<typeof Row>;
const rows: Row[] = Array.from({ length: 10_000 }, (_, id) => ({ id, name: `user-${id}`, active: id % 2 === 0 }));
const text = JIT.ndjson.stringify(Row)(rows);
const parse = JIT.ndjson.parse(Row);
const PublicRow = JIT.object({ id: JIT.number().int(), name: JIT.string() });
const stringifyPublic = JIT.ndjson.stringify(PublicRow);
const fused = JIT.ndjson
  .parse(Row)
  .where((query) => query.eq("active", true))
  .select("id", "name")
  .to.ndjson();
const aot = await loadAotArtifacts<{
  readonly parse: typeof parse;
  readonly fused: typeof fused;
}>({ parse, fused });

function idiomaticParse(input: string): unknown[] {
  return input.split("\n").map((line) => JSON.parse(line));
}

function handwrittenFused(input: string): string {
  let out = "";
  let start = 0;
  while (start < input.length) {
    const cut = input.indexOf("\n", start);
    const end = cut === -1 ? input.length : cut;
    const row = JSON.parse(input.slice(start, end)) as Row;
    if (row.active) {
      if (out.length !== 0) out += "\n";
      out += `{"id":${row.id},"name":${JSON.stringify(row.name)}}`;
    }
    if (cut === -1) break;
    start = cut + 1;
  }
  return out;
}

function idiomaticPipeline(input: string): string {
  return input
    .split("\n")
    .map((line) => JSON.parse(line) as Row)
    .filter((row) => row.active)
    .map((row) => JSON.stringify({ id: row.id, name: row.name }))
    .join("\n");
}

function validatedMaterialized(input: string): string {
  return stringifyPublic(
    parse(input)
      .filter((row) => row.active)
      .map((row) => ({ id: row.id, name: row.name }))
  );
}

registerScenario({
  op: "ndjson.parse",
  name: "10000 rows / 0.45 MB",
  args: [text],
  jit: parse,
  competitors: [
    { name: "JIT AOT", fn: aot.parse },
    {
      name: "split + JSON.parse",
      fn: idiomaticParse,
      biased: "the idiomatic baseline does not validate the parsed rows",
    },
  ],
});

registerScenario({
  op: "ndjson.pipeline",
  name: "10000 rows / filter + select + stringify",
  args: [text],
  jit: fused,
  competitors: [
    { name: "JIT AOT", fn: aot.fused },
    {
      name: "handwritten fused",
      fn: handwrittenFused,
      biased: "the handwritten ceiling parses JSON but does not validate the row schema",
    },
    {
      name: "split/map/filter/map/join",
      fn: idiomaticPipeline,
      biased: "the idiomatic pipeline does not validate the parsed rows",
    },
    { name: "validated materialized pipeline", fn: validatedMaterialized },
  ],
});

await runSuite("ndjson");
