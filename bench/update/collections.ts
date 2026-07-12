import { JIT } from "@jit/compiler";
import { produce } from "../shared/competitors.js";
import { createNumberMap, createNumberSet, NumberMapSchema, NumberSetSchema } from "../shared/data.js";
import { registerScenario } from "../shared/scenario.js";

export function registerCollectionUpdates(): void {
  registerScenario({
    op: "update",
    name: "set 10000",
    args: [createNumberSet(10_000), createNumberSet(10_001)],
    jit: JIT.compileUpdate(NumberSetSchema.schema),
    competitors: [
      {
        name: "immer",
        fn: (value: Set<number>) =>
          produce(value, (draft) => {
            draft.add(10_000);
          }),
      },
    ],
  });

  registerScenario({
    op: "update",
    name: "map 10000",
    args: [createNumberMap(10_000), new Map([...createNumberMap(10_000), ["key-9999", 42]])],
    jit: JIT.compileUpdate(NumberMapSchema.schema),
    competitors: [
      {
        name: "immer",
        fn: (value: Map<string, number>) =>
          produce(value, (draft) => {
            draft.set("key-9999", 42);
          }),
      },
    ],
  });
}
