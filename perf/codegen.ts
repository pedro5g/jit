import { Compiler, JIT } from "../packages/jit/src/index.js";
import { measurePhases, measureRatio } from "./harness/measure.js";

const schema = JIT.array(JIT.string()).length(5);
const input = ["a", "b", "c", "d", "e"];
const generated = JIT.validate.is(schema);
const handwritten = (): boolean => {
  if (!Array.isArray(input) || input.length !== 5) return false;
  for (let index = 0; index < input.length; index++) if (typeof input[index] !== "string") return false;
  return true;
};
const measurement = measureRatio("array.fixed-length.generated-vs-handwritten", handwritten, () => generated(input), {
  warmup: 2_000,
  samples: 21,
  iterations: 2_000,
});
const phases = measurePhases(
  "array.fixed-length.compile-phases",
  () => JIT.validate.is(schema),
  (compiled) => compiled(input)
);

console.log(
  JSON.stringify(
    {
      measurement,
      phases,
      sourceBytes: Compiler.emitValidatorSource(schema.schema, { ops: ["is"] }).length,
      physical: generated.explain({ physical: true }),
    },
    null,
    2
  )
);
