import { JIT } from "jit";
import { registerEqualScenario } from "./shared.js";

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

const left = {
  value: 0,
  next: {
    value: 1,
    next: {
      value: 2,
      next: {
        value: 3,
        next: {
          value: 4,
          next: {
            value: 5,
            next: {
              value: 6,
              next: {
                value: 7,
                next: {
                  value: 8,
                  next: {
                    value: 9,
                  },
                },
              },
            },
          },
        },
      },
    },
  },
};

export function registerDeepObject(): void {
  registerEqualScenario({
    name: "deep nested",
    left,
    right: structuredClone(left),
    jitEqual: equal,
  });
}
