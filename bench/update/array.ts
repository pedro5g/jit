import { JIT } from "@jit-compiler/jit";
import { produce } from "../shared/competitors.js";
import { createNestedUsers, createUsers, type MediumUser, NestedArraysSchema, UsersSchema } from "../shared/data.js";
import { registerScenario } from "../shared/scenario.js";

export function registerArrayUpdates(): void {
  registerScenario({
    op: "update",
    name: "large array changed at end",
    args: [createUsers(10_000), new Array(9_999).concat({ profile: { score: 999 } })],
    jit: JIT.compileUpdate(UsersSchema.schema),
    competitors: [
      {
        name: "immer",
        fn: (value: MediumUser[]) => produce(value, (draft) => void (draft[9_999].profile.score = 999)),
      },
    ],
  });

  registerScenario({
    op: "update",
    name: "nested arrays",
    args: [createNestedUsers(500, 20), [undefined, new Array(499).concat({ profile: { score: 999 } })]],
    jit: JIT.compileUpdate(NestedArraysSchema.schema),
    competitors: [
      {
        name: "immer",
        fn: (value: MediumUser[][]) => produce(value, (draft) => void (draft[1][499].profile.score = 999)),
      },
    ],
  });
}
