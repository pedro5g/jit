import { zx } from "@traversable/zod";
import { JIT } from "jit";
import { z } from "zod";
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

const TraversableSmallUser = z.object({
  id: z.number(),
  name: z.string(),
  active: z.boolean(),
});
const TraversableMediumUser = z.object({
  id: z.number(),
  name: z.string(),
  active: z.boolean(),
  profile: z.object({
    email: z.string(),
    age: z.number(),
    score: z.number(),
  }),
});
const TraversableDeepUser = z.object({
  id: z.number(),
  profile: z.object({
    name: z.string(),
    address: z.object({
      city: z.string(),
      zip: z.number(),
    }),
  }),
});

export function registerObjectClones(): void {
  registerScenario({
    op: "clone",
    name: "small object",
    args: [createSmallUser()],
    jit: JIT.compileClone(SmallUserSchema.schema),
    competitors: [
      { name: "traversable/zod deepClone", fn: zx.deepClone(TraversableSmallUser) },
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
      { name: "traversable/zod deepClone", fn: zx.deepClone(TraversableMediumUser) },
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
      { name: "traversable/zod deepClone", fn: zx.deepClone(TraversableDeepUser) },
      { name: "rfdc", fn: rfdcClone },
      { name: "lodash.cloneDeep", fn: lodashCloneDeep },
      { name: "structuredClone", fn: structuredClone },
    ],
  });
}
