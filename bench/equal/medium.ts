import { JIT } from "jit";
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

export function registerMediumObject(): void {
  registerEqualScenario({
    name: "medium object",
    left: { id: 1, name: "Ada", profile: { age: 37, email: "ada@example.com" } },
    right: { id: 1, name: "Ada", profile: { age: 37, email: "ada@example.com" } },
    jitEqual: equal,
  });
}
