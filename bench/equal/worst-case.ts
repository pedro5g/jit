import { JIT } from "@pedro5g/jit";
import { fastEqual, lodashIsEqual } from "../shared/competitors.js";
import { range } from "../shared/data.js";
import { registerScenario } from "../shared/scenario.js";

const RecordLike = JIT.object({
  id: JIT.number(),
  a: JIT.string(),
  b: JIT.string(),
  c: JIT.number(),
});
const Records = JIT.array(RecordLike);
const equal = JIT.compileEqual(Records.schema);

const left = range(25_000).map((id) => ({
  id,
  a: `a-${id}`,
  b: `b-${id}`,
  c: id * 2,
}));

export function registerWorstCase(): void {
  registerScenario({
    op: "equal",
    name: "worst-case equal",
    args: [left, structuredClone(left)],
    jit: equal,
    competitors: [
      { name: "fast-deep-equal", fn: fastEqual },
      { name: "lodash.isEqual", fn: lodashIsEqual },
    ],
  });
}
