import { createRequire } from "node:module";
import { JIT } from "jit";
import { bench, do_not_optimize, run } from "mitata";
import rfdcFactory from "rfdc";
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

const require = createRequire(import.meta.url);
const lodashCloneDeep = require("lodash.clonedeep") as <T>(value: T) => T;
const rfdcClone = rfdcFactory();

function registerCloneScenario<T>(name: string, value: T, jitClone: (value: T) => T): void {
  bench(`JIT clone / ${name}`, () => do_not_optimize(jitClone(value)));
  bench(`rfdc / ${name}`, () => do_not_optimize(rfdcClone(value)));
  bench(`lodash.cloneDeep / ${name}`, () => do_not_optimize(lodashCloneDeep(value)));
  bench(`structuredClone / ${name}`, () => do_not_optimize(structuredClone(value)));
}

registerCloneScenario("small object", createSmallUser(), JIT.compileClone(SmallUserSchema.schema));
registerCloneScenario("medium object", createMediumUser(), JIT.compileClone(MediumUserSchema.schema));
registerCloneScenario("deep object", createDeepUser(), JIT.compileClone(DeepUserSchema.schema));
registerCloneScenario("large array 10000", createUsers(10_000), JIT.compileClone(UsersSchema.schema));
registerCloneScenario("nested arrays", createNestedUsers(500, 20), JIT.compileClone(NestedArraysSchema.schema));
registerCloneScenario("set 10000", createNumberSet(10_000), JIT.compileClone(NumberSetSchema.schema));
registerCloneScenario("map 10000", createNumberMap(10_000), JIT.compileClone(NumberMapSchema.schema));

await run();
