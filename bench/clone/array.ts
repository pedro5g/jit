import { JIT } from "@pedro5g/jit";
import { zx } from "@traversable/zod";
import { z } from "zod";
import { lodashCloneDeep, rfdcClone } from "../shared/competitors.js";
import { createNestedUsers, createUsers, NestedArraysSchema, UsersSchema } from "../shared/data.js";
import { registerScenario } from "../shared/scenario.js";

const TraversableMediumUser = z.object({
  id: z.number(),
  name: z.string(),
  active: z.boolean(),
  profile: z.object({
    email: z.string(),
    age: z.number(),
    score: z.number(),
  }),
});
const TraversableUsers = z.array(TraversableMediumUser);
const TraversableNestedUsers = z.array(TraversableUsers);

export function registerArrayClones(): void {
  registerScenario({
    op: "clone",
    name: "large array 10000",
    args: [createUsers(10_000)],
    jit: JIT.compileClone(UsersSchema.schema),
    competitors: [
      { name: "traversable/zod deepClone", fn: zx.deepClone(TraversableUsers) },
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
      { name: "traversable/zod deepClone", fn: zx.deepClone(TraversableNestedUsers) },
      { name: "rfdc", fn: rfdcClone },
      { name: "lodash.cloneDeep", fn: lodashCloneDeep },
      { name: "structuredClone", fn: structuredClone },
    ],
  });
}
