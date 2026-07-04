import { JIT } from "jit";
import { lodashCloneDeep, rfdcClone } from "../shared/competitors.js";
import {
  createDeepUser,
  createMediumUser,
  createSmallUser,
  DeepUserSchema,
  MediumUserSchema,
  SmallUserSchema,
} from "../shared/data.js";
import { registerScenario } from "../shared/scenario.js";

export function registerObjectClones(): void {
  registerScenario({
    op: "clone",
    name: "small object",
    args: [createSmallUser()],
    jit: JIT.compileClone(SmallUserSchema.schema),
    competitors: [
      { name: "rfdc", fn: rfdcClone },
      { name: "lodash.cloneDeep", fn: lodashCloneDeep },
      { name: "structuredClone", fn: structuredClone },
    ],
  });

  registerScenario({
    op: "clone",
    name: "medium object",
    args: [createMediumUser()],
    jit: JIT.compileClone(MediumUserSchema.schema),
    competitors: [
      { name: "rfdc", fn: rfdcClone },
      { name: "lodash.cloneDeep", fn: lodashCloneDeep },
      { name: "structuredClone", fn: structuredClone },
    ],
  });

  registerScenario({
    op: "clone",
    name: "deep object",
    args: [createDeepUser()],
    jit: JIT.compileClone(DeepUserSchema.schema),
    competitors: [
      { name: "rfdc", fn: rfdcClone },
      { name: "lodash.cloneDeep", fn: lodashCloneDeep },
      { name: "structuredClone", fn: structuredClone },
    ],
  });
}
