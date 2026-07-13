import { JIT } from "@jit-compiler/jit";
import { runSuite } from "../shared/persist.js";
import { registerScenario } from "../shared/scenario.js";

const COUNT = 1_000_000;
const Shape = JIT.discriminatedUnion("kind", [
  JIT.object({ kind: JIT.literal("circle"), id: JIT.number().int32(), area: JIT.number().float32() }),
  JIT.object({ kind: JIT.literal("rectangle"), id: JIT.number().int32(), area: JIT.number().float32() }),
  JIT.object({ kind: JIT.literal("triangle"), id: JIT.number().int32(), area: JIT.number().float32() }),
]);
const Shapes = JIT.array(Shape);
type Shape = JIT.infer<typeof Shape>;

const values = createShapes(COUNT);
const binary = Shapes.binary({ strategy: "exact", memoryLayout: "columnar" });
const rowset = binary.load(values);
const countCircles = JIT.query(rowset)
  .filter((q) => q.eq("kind", "circle"))
  .count()
  .compile();
const sumCircles = JIT.query(rowset)
  .filter((q) => q.eq("kind", "circle"))
  .sum("area")
  .compile();

registerScenario({
  op: "binary tagged union count",
  name: `${COUNT} variants`,
  args: [rowset],
  jit: countCircles,
  competitors: [{ name: "native string discriminator", fn: () => nativeCount(values) }],
});

registerScenario({
  op: "binary tagged union sum",
  name: `${COUNT} variants`,
  args: [rowset],
  jit: sumCircles,
  competitors: [{ name: "native string discriminator", fn: () => nativeSum(values) }],
});

function createShapes(count: number): Shape[] {
  const output = new Array<Shape>(count);
  for (let index = 0; index < count; index++) {
    const kind = index % 3 === 0 ? "circle" : index % 3 === 1 ? "rectangle" : "triangle";
    output[index] = { kind, id: index, area: index % 1000 };
  }
  return output;
}

function nativeCount(input: readonly Shape[]): number {
  let count = 0;
  for (let index = 0; index < input.length; index++) if (input[index].kind === "circle") count++;
  return count;
}

function nativeSum(input: readonly Shape[]): number {
  let total = 0;
  for (let index = 0; index < input.length; index++) {
    const item = input[index];
    if (item.kind === "circle") total += item.area;
  }
  return total;
}

await runSuite("binary-compositions");
