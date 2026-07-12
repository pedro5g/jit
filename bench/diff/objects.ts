import { JIT } from "@pedro5g/jit";
import { microdiff } from "../shared/competitors.js";
import {
  createDeepUser,
  createMediumUser,
  createSmallUser,
  DeepUserSchema,
  MediumUserSchema,
  SmallUserSchema,
} from "../shared/data.js";
import { registerScenario } from "../shared/scenario.js";

type MicrodiffInput = Record<string, unknown> | unknown[];

const microdiffCompare = (left: object, right: object) => microdiff(left as MicrodiffInput, right as MicrodiffInput);

export function registerObjectDiffs(): void {
  registerScenario({
    op: "diff",
    name: "small object unchanged",
    args: [createSmallUser(), createSmallUser()],
    jit: JIT.compileDiff(SmallUserSchema.schema),
    competitors: [{ name: "microdiff", fn: microdiffCompare }],
  });

  registerScenario({
    op: "diff",
    name: "small object changed",
    args: [createSmallUser(), { ...createSmallUser(), name: "changed" }],
    jit: JIT.compileDiff(SmallUserSchema.schema),
    competitors: [{ name: "microdiff", fn: microdiffCompare }],
  });

  registerScenario({
    op: "diff",
    name: "medium object nested",
    args: [createMediumUser(), { ...createMediumUser(), profile: { ...createMediumUser().profile, score: 999 } }],
    jit: JIT.compileDiff(MediumUserSchema.schema),
    competitors: [{ name: "microdiff", fn: microdiffCompare }],
  });

  registerScenario({
    op: "diff",
    name: "deep object nested",
    args: [
      createDeepUser(),
      { ...createDeepUser(), profile: { ...createDeepUser().profile, address: { city: "changed", zip: 99999 } } },
    ],
    jit: JIT.compileDiff(DeepUserSchema.schema),
    competitors: [{ name: "microdiff", fn: microdiffCompare }],
  });
}
