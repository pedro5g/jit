import { zx } from "@traversable/zod";
import { JIT } from "jit";
import { z } from "zod";
import { registerEqualScenario } from "./shared.js";

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
  registerEqualScenario({
    name: "small object",
    left: { id: 1, name: "Ada" },
    right: { id: 1, name: "Ada" },
    jitEqual: equal,
    extra: [{ name: "traversable/zod deepEqual", equal: traversableEqual }],
  });

  registerEqualScenario({
    name: "small object early fail",
    left: { id: 1, name: "Ada" },
    right: { id: 2, name: "Ada" },
    jitEqual: equal,
    extra: [{ name: "traversable/zod deepEqual", equal: traversableEqual }],
  });
}
