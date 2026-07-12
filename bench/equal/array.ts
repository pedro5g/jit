import { JIT } from "@jit/compiler";
import { fastEqual, lodashIsEqual } from "../shared/competitors.js";
import { range } from "../shared/data.js";
import { registerScenario } from "../shared/scenario.js";

const User = JIT.object({
  id: JIT.number(),
  name: JIT.string(),
});
const Users = JIT.array(User);
const equal = JIT.compileEqual(Users.schema);

function createUsers(length: number): { readonly id: number; readonly name: string }[] {
  return range(length).map((id) => ({ id, name: `user-${id}` }));
}

export function registerArrayScenarios(): void {
  for (const size of [10_000, 50_000, 100_000]) {
    registerScenario({
      op: "equal",
      name: `large array ${size}`,
      args: [createUsers(size), createUsers(size)],
      jit: equal,
      competitors: [
        { name: "fast-deep-equal", fn: fastEqual },
        { name: "lodash.isEqual", fn: lodashIsEqual },
      ],
    });
  }
}
