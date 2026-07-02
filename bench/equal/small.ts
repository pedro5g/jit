import { JIT } from "jit";
import { registerEqualScenario } from "./shared.js";

const User = JIT.object({
  id: JIT.number(),
  name: JIT.string(),
});

const equal = JIT.compileEqual(User.schema);

export function registerSmallObject(): void {
  registerEqualScenario({
    name: "small object",
    left: { id: 1, name: "Ada" },
    right: { id: 1, name: "Ada" },
    jitEqual: equal,
  });

  registerEqualScenario({
    name: "small object early fail",
    left: { id: 1, name: "Ada" },
    right: { id: 2, name: "Ada" },
    jitEqual: equal,
  });
}
