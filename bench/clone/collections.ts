import { JIT } from "@jit-compiler/jit";
import { lodashCloneDeep, rfdcClone } from "../shared/competitors.js";
import { createNumberMap, createNumberSet, NumberMapSchema, NumberSetSchema } from "../shared/data.js";
import { registerScenario } from "../shared/scenario.js";

// rfdc's default configuration does not deep-clone Set/Map contents (they come
// back as plain empty objects), so it does strictly less work here.
const RFDC_SET_MAP_BIAS = "rfdc default does not clone Set/Map entries";

export function registerCollectionClones(): void {
  registerScenario({
    op: "clone",
    name: "set 10000",
    args: [createNumberSet(10_000)],
    jit: JIT.compileClone(NumberSetSchema.schema),
    competitors: [
      { name: "rfdc", fn: rfdcClone, biased: RFDC_SET_MAP_BIAS },
      { name: "lodash.cloneDeep", fn: lodashCloneDeep },
      { name: "structuredClone", fn: structuredClone },
    ],
  });

  registerScenario({
    op: "clone",
    name: "map 10000",
    args: [createNumberMap(10_000)],
    jit: JIT.compileClone(NumberMapSchema.schema),
    competitors: [
      { name: "rfdc", fn: rfdcClone, biased: RFDC_SET_MAP_BIAS },
      { name: "lodash.cloneDeep", fn: lodashCloneDeep },
      { name: "structuredClone", fn: structuredClone },
    ],
  });
}
