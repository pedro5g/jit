import { JIT } from "jit";
import { microdiff } from "../shared/competitors.js";
import { createNumberMap, createNumberSet, NumberMapSchema, NumberSetSchema } from "../shared/data.js";
import { registerScenario } from "../shared/scenario.js";

// microdiff cannot walk Set/Map, so it receives pre-converted array/object
// copies (conversion cost excluded from the measurement) — strictly less work.
const SEMANTIC_BIAS = "operates on pre-converted array/object copies of Set/Map";

export function registerCollectionDiffs(): void {
  {
    const left = createNumberSet(10_000);
    const right = createNumberSet(10_001);
    const leftArray = Array.from(left);
    const rightArray = Array.from(right);

    registerScenario({
      op: "diff",
      name: "set 10000",
      args: [left, right],
      jit: JIT.compileDiff(NumberSetSchema.schema),
      competitors: [{ name: "microdiff semantic", fn: () => microdiff(leftArray, rightArray), biased: SEMANTIC_BIAS }],
    });
  }

  {
    const left = createNumberMap(10_000);
    const right = new Map([...createNumberMap(10_000), ["key-9999", 42]]);
    const leftRecord = Object.fromEntries(left);
    const rightRecord = Object.fromEntries(right);

    registerScenario({
      op: "diff",
      name: "map 10000",
      args: [left, right],
      jit: JIT.compileDiff(NumberMapSchema.schema),
      competitors: [
        { name: "microdiff semantic", fn: () => microdiff(leftRecord, rightRecord), biased: SEMANTIC_BIAS },
      ],
    });
  }
}
