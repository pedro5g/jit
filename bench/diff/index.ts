import { JIT } from "jit";
import microdiff from "microdiff";
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

type MicrodiffInput = Record<string, unknown> | unknown[];

function registerDiffScenario<T extends object>(
  name: string,
  left: T,
  right: T,
  jitDiff: (left: T, right: T) => unknown
): void {
  bench(`JIT diff / ${name}`, () => do_not_optimize(jitDiff(left, right)));
  bench(`microdiff / ${name}`, () => do_not_optimize(microdiff(left as MicrodiffInput, right as MicrodiffInput)));
}

function registerSemanticDiffScenario<T>(
  name: string,
  left: T,
  right: T,
  jitDiff: (left: T, right: T) => unknown,
  microdiffLeft: MicrodiffInput,
  microdiffRight: MicrodiffInput
): void {
  bench(`JIT diff / ${name}`, () => do_not_optimize(jitDiff(left, right)));
  bench(`microdiff semantic / ${name}`, () => do_not_optimize(microdiff(microdiffLeft, microdiffRight)));
}

registerDiffScenario(
  "small object unchanged",
  createSmallUser(),
  createSmallUser(),
  JIT.compileDiff(SmallUserSchema.schema)
);
registerDiffScenario(
  "small object changed",
  createSmallUser(),
  { ...createSmallUser(), name: "changed" },
  JIT.compileDiff(SmallUserSchema.schema)
);
registerDiffScenario(
  "medium object nested",
  createMediumUser(),
  { ...createMediumUser(), profile: { ...createMediumUser().profile, score: 999 } },
  JIT.compileDiff(MediumUserSchema.schema)
);
registerDiffScenario(
  "deep object nested",
  createDeepUser(),
  { ...createDeepUser(), profile: { ...createDeepUser().profile, address: { city: "changed", zip: 99999 } } },
  JIT.compileDiff(DeepUserSchema.schema)
);
{
  const left = createUsers(10_000);
  const right = createUsers(10_000);
  right[9_999] = { ...right[9_999], profile: { ...right[9_999].profile, score: 999 } };
  registerDiffScenario("large array changed at end", left, right, JIT.compileDiff(UsersSchema.schema));
}
{
  const left = createNestedUsers(500, 20);
  const right = createNestedUsers(500, 20);
  right[1][499] = { ...right[1][499], profile: { ...right[1][499].profile, score: 999 } };
  registerDiffScenario("nested arrays", left, right, JIT.compileDiff(NestedArraysSchema.schema));
}
{
  const left = createNumberSet(10_000);
  const right = createNumberSet(10_001);
  registerSemanticDiffScenario(
    "set 10000",
    left,
    right,
    JIT.compileDiff(NumberSetSchema.schema),
    Array.from(left),
    Array.from(right)
  );
}
{
  const left = createNumberMap(10_000);
  const right = new Map([...createNumberMap(10_000), ["key-9999", 42]]);
  registerSemanticDiffScenario(
    "map 10000",
    left,
    right,
    JIT.compileDiff(NumberMapSchema.schema),
    Object.fromEntries(left),
    Object.fromEntries(right)
  );
}

await run();
