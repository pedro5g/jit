import { JIT } from "@jit-compiler/jit";
import { fastEqual, lodashIsEqual } from "../shared/competitors.js";
import { registerScenario } from "../shared/scenario.js";

const Node10 = JIT.object({
  value: JIT.number(),
  next: JIT.object({
    value: JIT.number(),
    next: JIT.object({
      value: JIT.number(),
      next: JIT.object({
        value: JIT.number(),
        next: JIT.object({
          value: JIT.number(),
          next: JIT.object({
            value: JIT.number(),
            next: JIT.object({
              value: JIT.number(),
              next: JIT.object({
                value: JIT.number(),
                next: JIT.object({
                  value: JIT.number(),
                  next: JIT.object({
                    value: JIT.number(),
                  }),
                }),
              }),
            }),
          }),
        }),
      }),
    }),
  }),
});

const equal = JIT.compileEqual(Node10.schema);

interface DeepNode {
  readonly value: number;
  readonly next?: DeepNode;
}

function createDeepNode(depth: number, value = 0): DeepNode {
  if (depth === 1) return { value };
  return { value, next: createDeepNode(depth - 1, value + 1) };
}

const left = createDeepNode(10);

export function registerDeepObject(): void {
  registerScenario({
    op: "equal",
    name: "deep nested",
    args: [left, structuredClone(left)],
    jit: equal as (left: DeepNode, right: DeepNode) => boolean,
    competitors: [
      { name: "fast-deep-equal", fn: fastEqual },
      { name: "lodash.isEqual", fn: lodashIsEqual },
    ],
  });
}
