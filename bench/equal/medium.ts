import { zx } from "@traversable/zod";
import { JIT } from "jit";
import { z } from "zod";
import { fastEqual, lodashIsEqual } from "../shared/competitors.js";
import { registerScenario } from "../shared/scenario.js";

const User = JIT.object({
  id: JIT.number(),
  name: JIT.string(),
  profile: JIT.object({
    age: JIT.number(),
    email: JIT.string(),
  }),
});

const equal = JIT.compileEqual(User.schema);
const TraversableUser = z.object({
  id: z.number(),
  name: z.string(),
  profile: z.object({
    age: z.number(),
    email: z.string(),
  }),
});
const traversableEqual = zx.deepEqual(TraversableUser);

export function registerMediumObject(): void {
  registerScenario({
    op: "equal",
    name: "medium object",
    args: [
      { id: 1, name: "Ada", profile: { age: 37, email: "ada@example.com" } },
      { id: 1, name: "Ada", profile: { age: 37, email: "ada@example.com" } },
    ],
    jit: equal,
    competitors: [
      { name: "fast-deep-equal", fn: fastEqual },
      { name: "lodash.isEqual", fn: lodashIsEqual },
      { name: "traversable/zod deepEqual", fn: traversableEqual },
    ],
  });
}
