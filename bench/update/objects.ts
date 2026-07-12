import { JIT } from "@jit/compiler";
import { produce } from "../shared/competitors.js";
import {
  createDeepUser,
  createMediumUser,
  createSmallUser,
  type DeepUser,
  DeepUserSchema,
  type MediumUser,
  MediumUserSchema,
  type SmallUser,
  SmallUserSchema,
} from "../shared/data.js";
import { registerScenario } from "../shared/scenario.js";

export function registerObjectUpdates(): void {
  registerScenario({
    op: "update",
    name: "small object unchanged",
    args: [createSmallUser(), {}],
    jit: JIT.compileUpdate(SmallUserSchema.schema),
    competitors: [{ name: "immer", fn: (value: SmallUser) => produce(value, () => {}) }],
  });

  registerScenario({
    op: "update",
    name: "small object changed",
    args: [createSmallUser(), { name: "changed" }],
    jit: JIT.compileUpdate(SmallUserSchema.schema),
    competitors: [
      { name: "immer", fn: (value: SmallUser) => produce(value, (draft) => void (draft.name = "changed")) },
    ],
  });

  registerScenario({
    op: "update",
    name: "medium object nested",
    args: [createMediumUser(), { profile: { score: 999 } }],
    jit: JIT.compileUpdate(MediumUserSchema.schema),
    competitors: [
      { name: "immer", fn: (value: MediumUser) => produce(value, (draft) => void (draft.profile.score = 999)) },
    ],
  });

  registerScenario({
    op: "update",
    name: "deep object nested",
    args: [createDeepUser(), { profile: { address: { zip: 99999 } } }],
    jit: JIT.compileUpdate(DeepUserSchema.schema),
    competitors: [
      { name: "immer", fn: (value: DeepUser) => produce(value, (draft) => void (draft.profile.address.zip = 99999)) },
    ],
  });
}
