import { JIT } from "../../packages/jit/src/index.js";
import { loadAotArtifacts } from "../shared/aot.js";
import { runSuite } from "../shared/persist.js";
import { registerScenario } from "../shared/scenario.js";

const Row = JIT.object({ id: JIT.number().int(), name: JIT.string(), active: JIT.boolean() });
type Row = JIT.Typeof<typeof Row>;
const rows: Row[] = Array.from({ length: 10_000 }, (_, id) => ({ id, name: `user-${id}`, active: id % 2 === 0 }));
const text = JIT.csv.stringify(Row)(rows);
const parse = JIT.csv.parse(Row);
const stringify = JIT.csv.stringify(Row);
const aot = await loadAotArtifacts<{ readonly parse: typeof parse; readonly stringify: typeof stringify }>({
  parse,
  stringify,
});

function handwrittenParse(input: string): Row[] {
  const out = new Array<Row>(10_000);
  let start = input.indexOf("\n") + 1;
  let row = 0;
  while (start < input.length) {
    const end = input.indexOf("\n", start);
    const first = input.indexOf(",", start);
    const second = input.indexOf(",", first + 1);
    out[row++] = {
      id: Number(input.slice(start, first)),
      name: input.slice(first + 1, second),
      active: input.charCodeAt(second + 1) === 116,
    };
    if (end === -1) break;
    start = end + 1;
  }
  return out;
}

function handwrittenStringify(value: readonly Row[]): string {
  let out = "id,name,active";
  for (let i = 0; i < value.length; i++) {
    const row = value[i] as Row;
    out += `\r\n${row.id},${row.name},${row.active}`;
  }
  return out;
}

registerScenario({
  op: "csv.parse",
  name: "10000 scalar rows / 0.21 MB",
  args: [text],
  jit: parse,
  competitors: [
    { name: "JIT AOT", fn: aot.parse },
    {
      name: "handwritten known-clean ceiling",
      fn: handwrittenParse,
      biased: "the ceiling assumes no quoted fields and is not a complete RFC 4180 parser",
    },
  ],
});

registerScenario({
  op: "csv.stringify",
  name: "10000 scalar rows / 0.21 MB",
  args: [rows],
  jit: stringify,
  competitors: [
    { name: "JIT AOT", fn: aot.stringify },
    {
      name: "handwritten known-clean ceiling",
      fn: handwrittenStringify,
      biased: "the ceiling assumes every field is already safe without RFC 4180 escaping",
    },
  ],
});

await runSuite("csv");
