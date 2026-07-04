import { JIT } from "jit";
import { microdiff } from "../shared/competitors.js";
import { createNestedUsers, createUsers, NestedArraysSchema, UsersSchema } from "../shared/data.js";
import { registerScenario } from "../shared/scenario.js";

export function registerArrayDiffs(): void {
  {
    const left = createUsers(10_000);
    const right = createUsers(10_000);
    right[9_999] = { ...right[9_999], profile: { ...right[9_999].profile, score: 999 } };

    registerScenario({
      op: "diff",
      name: "large array changed at end",
      args: [left, right],
      jit: JIT.compileDiff(UsersSchema.schema),
      competitors: [{ name: "microdiff", fn: microdiff }],
    });
  }

  {
    const left = createNestedUsers(500, 20);
    const right = createNestedUsers(500, 20);
    right[1][499] = { ...right[1][499], profile: { ...right[1][499].profile, score: 999 } };

    registerScenario({
      op: "diff",
      name: "nested arrays",
      args: [left, right],
      jit: JIT.compileDiff(NestedArraysSchema.schema),
      competitors: [{ name: "microdiff", fn: microdiff }],
    });
  }
}
