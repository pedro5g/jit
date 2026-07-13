import { JIT } from "@jit-compiler/jit";
import { createMediumUser, type MediumUser, MediumUserSchema } from "../shared/data.js";
import { registerScenario } from "../shared/scenario.js";
import { genericMerge, genericOmit, genericPick, genericTransform } from "./generic.js";

const GENERIC_BIAS = "handwritten generic baseline, not a published library";

const PICK_KEYS = ["id", "name"] as const;
const OMIT_KEYS = ["profile"] as const;

export function registerSingleObjectOps(): void {
  registerScenario({
    op: "merge",
    name: "medium nested",
    args: [createMediumUser(), { profile: { score: 999 } }],
    jit: JIT.compileMerge(MediumUserSchema.schema),
    competitors: [{ name: "generic merge", fn: genericMerge, biased: GENERIC_BIAS }],
  });

  registerScenario({
    op: "pick",
    name: "medium object",
    args: [createMediumUser()],
    jit: JIT.compilePick(MediumUserSchema.schema, ["id", "name"]),
    competitors: [
      { name: "generic pick", fn: (value: MediumUser) => genericPick(value, PICK_KEYS), biased: GENERIC_BIAS },
    ],
  });

  registerScenario({
    op: "omit",
    name: "medium object",
    args: [createMediumUser()],
    jit: JIT.compileOmit(MediumUserSchema.schema, ["profile"]),
    competitors: [
      { name: "generic omit", fn: (value: MediumUser) => genericOmit(value, OMIT_KEYS), biased: GENERIC_BIAS },
    ],
  });

  const transforms = {
    name: (value: unknown) => String(value).toUpperCase(),
    active: (value: unknown) => !value,
  };

  registerScenario({
    op: "transform",
    name: "medium object",
    args: [createMediumUser()],
    jit: JIT.compileTransform(MediumUserSchema.schema, {
      name: (value) => value.toUpperCase(),
      active: (value) => !value,
    }),
    competitors: [
      {
        name: "generic transform",
        fn: (value: MediumUser) => genericTransform(value, transforms),
        biased: GENERIC_BIAS,
      },
    ],
  });
}
