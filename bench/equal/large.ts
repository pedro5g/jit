import { JIT } from "jit";
import { range, registerEqualScenario } from "./shared.js";

const User = JIT.object({
  id: JIT.number(),
  name: JIT.string(),
});
const Users = JIT.array(User).entity({ key: "id" }).indexBy("id");
const indexedEqual = JIT.compileEqual(Users.schema);

const left = range(50_000).map((id) => ({ id, name: `user-${id}` }));
const right = [...left].reverse();

function findEqual(
  leftValue: readonly { readonly id: number; readonly name: string }[],
  rightValue: readonly { readonly id: number; readonly name: string }[]
): boolean {
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
  registerEqualScenario({
    name: "entity index array",
    left,
    right,
    jitEqual: indexedEqual,
    includeGenericBaselines: false,
    extra: [{ name: "manual find", equal: findEqual }],
  });
}
