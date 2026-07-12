import { JIT } from "@pedro5g/jit";
import { range } from "../shared/data.js";
import { registerScenario } from "../shared/scenario.js";

interface Entity {
  readonly id: number;
  readonly name: string;
}

const User = JIT.object({
  id: JIT.number(),
  name: JIT.string(),
});
const Users = JIT.array(User).entity({ key: "id" }).indexBy("id");
const indexedEqual = JIT.compileEqual(Users.schema);

const left = range(50_000).map((id) => ({ id, name: `user-${id}` }));
const right = [...left].reverse();

// Honest baseline: same order-insensitive semantics, O(n) via a Map index
// built per call — the fastest handwritten equivalent of what the compiled
// entity-index strategy does.
function mapIndexedEqual(leftValue: readonly Entity[], rightValue: readonly Entity[]): boolean {
  if (leftValue.length !== rightValue.length) return false;

  const index = new Map<number, Entity>();
  for (let i = 0; i < rightValue.length; i++) {
    const item = rightValue[i];
    index.set(item.id, item);
  }

  for (let i = 0; i < leftValue.length; i++) {
    const leftItem = leftValue[i];
    const rightItem = index.get(leftItem.id);

    if (!rightItem) return false;
    if (leftItem.name !== rightItem.name) return false;
  }

  return true;
}

function findEqual(leftValue: readonly Entity[], rightValue: readonly Entity[]): boolean {
  if (leftValue.length !== rightValue.length) return false;

  for (let i = leftValue.length; i-- !== 0; ) {
    const leftItem = leftValue[i];
    const rightItem = rightValue.find((item) => item.id === leftItem.id);

    if (!rightItem) return false;
    if (leftItem.id !== rightItem.id) return false;
    if (leftItem.name !== rightItem.name) return false;
  }

  return true;
}

export function registerEntityIndex(): void {
  registerScenario({
    op: "equal",
    name: "entity index array",
    args: [left, right],
    jit: indexedEqual,
    competitors: [
      { name: "map indexed equal", fn: mapIndexedEqual },
      {
        name: "manual find",
        fn: findEqual,
        biased: "O(n²) Array.prototype.find scan; kept only to illustrate the naive approach",
      },
    ],
  });
}
