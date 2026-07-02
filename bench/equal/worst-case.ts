import { JIT } from "jit";
import { range, registerEqualScenario } from "./shared.js";

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
  registerEqualScenario({
    name: "worst-case equal",
    left,
    right: structuredClone(left),
    jitEqual: equal,
  });
}
