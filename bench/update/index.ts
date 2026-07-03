import { enableMapSet, produce } from "immer";
import { JIT } from "jit";
import { bench, do_not_optimize, run } from "mitata";
import {
  createDeepUser,
  createMediumUser,
  createNestedUsers,
  createNumberMap,
  createNumberSet,
  createSmallUser,
  createUsers,
  DeepUserSchema,
  MediumUserSchema,
  NestedArraysSchema,
  NumberMapSchema,
  NumberSetSchema,
  SmallUserSchema,
  UsersSchema,
} from "../shared/data.js";

enableMapSet();

function registerUpdateScenario<T, TPatch>(
  name: string,
  value: T,
  patch: TPatch,
  jitUpdate: (value: T, patch: TPatch) => T,
  immerUpdate: (value: T) => T
): void {
  bench(`JIT update / ${name}`, () => do_not_optimize(jitUpdate(value, patch)));
  bench(`immer / ${name}`, () => do_not_optimize(immerUpdate(value)));
}

registerUpdateScenario(
  "small object unchanged",
  createSmallUser(),
  {},
  JIT.compileUpdate(SmallUserSchema.schema),
  (value) => produce(value, () => {})
);
registerUpdateScenario(
  "small object changed",
  createSmallUser(),
  { name: "changed" },
  JIT.compileUpdate(SmallUserSchema.schema),
  (value) => produce(value, (draft) => void (draft.name = "changed"))
);
registerUpdateScenario(
  "medium object nested",
  createMediumUser(),
  { profile: { score: 999 } },
  JIT.compileUpdate(MediumUserSchema.schema),
  (value) => produce(value, (draft) => void (draft.profile.score = 999))
);
registerUpdateScenario(
  "deep object nested",
  createDeepUser(),
  { profile: { address: { zip: 99999 } } },
  JIT.compileUpdate(DeepUserSchema.schema),
  (value) => produce(value, (draft) => void (draft.profile.address.zip = 99999))
);
registerUpdateScenario(
  "large array changed at end",
  createUsers(10_000),
  new Array(9_999).concat({ profile: { score: 999 } }),
  JIT.compileUpdate(UsersSchema.schema),
  (value) => produce(value, (draft) => void (draft[9_999].profile.score = 999))
);
registerUpdateScenario(
  "nested arrays",
  createNestedUsers(500, 20),
  [undefined, new Array(499).concat({ profile: { score: 999 } })],
  JIT.compileUpdate(NestedArraysSchema.schema),
  (value) => produce(value, (draft) => void (draft[1][499].profile.score = 999))
);
registerUpdateScenario(
  "set 10000",
  createNumberSet(10_000),
  createNumberSet(10_001),
  JIT.compileUpdate(NumberSetSchema.schema),
  (value) =>
    produce(value, (draft) => {
      draft.add(10_000);
    })
);
registerUpdateScenario(
  "map 10000",
  createNumberMap(10_000),
  new Map([...createNumberMap(10_000), ["key-9999", 42]]),
  JIT.compileUpdate(NumberMapSchema.schema),
  (value) =>
    produce(value, (draft) => {
      draft.set("key-9999", 42);
    })
);

await run();
