import { JIT } from "@jit-compiler/jit";
import { zx } from "@traversable/zod";
import { z } from "zod";
import { fastEqual, lodashIsEqual } from "../shared/competitors.js";
import { registerScenario } from "../shared/scenario.js";

const User = JIT.object({
  id: JIT.number(),
  name: JIT.string(),
});

const equal = JIT.compileEqual(User.schema);
const TraversableUser = z.object({
  id: z.number(),
  name: z.string(),
});
const traversableEqual = zx.deepEqual(TraversableUser);

export function registerSmallObject(): void {
  registerScenario({
    op: "equal",
    name: "small object",
    args: [
      { id: 1, name: "Ada" },
      { id: 1, name: "Ada" },
    ],
    jit: equal,
    competitors: [
      { name: "fast-deep-equal", fn: fastEqual },
      { name: "lodash.isEqual", fn: lodashIsEqual },
      { name: "traversable/zod deepEqual", fn: traversableEqual },
    ],
  });

  registerScenario({
    op: "equal",
    name: "small object early fail",
    args: [
      { id: 1, name: "Ada" },
      { id: 2, name: "Ada" },
    ],
    jit: equal,
    competitors: [
      { name: "fast-deep-equal", fn: fastEqual },
      { name: "lodash.isEqual", fn: lodashIsEqual },
      { name: "traversable/zod deepEqual", fn: traversableEqual },
    ],
  });
}
