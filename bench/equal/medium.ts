import { zx } from "@traversable/zod";
import { JIT } from "jit";
import { z } from "zod";
import { registerEqualScenario } from "./shared.js";

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
  registerEqualScenario({
    name: "medium object",
    left: { id: 1, name: "Ada", profile: { age: 37, email: "ada@example.com" } },
    right: { id: 1, name: "Ada", profile: { age: 37, email: "ada@example.com" } },
    jitEqual: equal,
    extra: [{ name: "traversable/zod deepEqual", equal: traversableEqual }],
  });
}
