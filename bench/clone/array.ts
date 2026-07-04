import { JIT } from "jit";
import { lodashCloneDeep, rfdcClone } from "../shared/competitors.js";
import { createNestedUsers, createUsers, NestedArraysSchema, UsersSchema } from "../shared/data.js";
import { registerScenario } from "../shared/scenario.js";

export function registerArrayClones(): void {
  registerScenario({
    op: "clone",
    name: "large array 10000",
    args: [createUsers(10_000)],
    jit: JIT.compileClone(UsersSchema.schema),
    competitors: [
      { name: "rfdc", fn: rfdcClone },
      { name: "lodash.cloneDeep", fn: lodashCloneDeep },
      { name: "structuredClone", fn: structuredClone },
    ],
  });

  registerScenario({
    op: "clone",
    name: "nested arrays",
    args: [createNestedUsers(500, 20)],
    jit: JIT.compileClone(NestedArraysSchema.schema),
    competitors: [
      { name: "rfdc", fn: rfdcClone },
      { name: "lodash.cloneDeep", fn: lodashCloneDeep },
      { name: "structuredClone", fn: structuredClone },
    ],
  });
}
