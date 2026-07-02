import { createRequire } from "node:module";
import fastEqual from "fast-deep-equal";
import { bench, do_not_optimize } from "mitata";

const require = createRequire(import.meta.url);
const lodashEqual = require("lodash.isequal") as (left: unknown, right: unknown) => boolean;

export interface EqualScenario<T> {
  readonly name: string;
  readonly left: T;
  readonly right: T;
  readonly jitEqual: (left: T, right: T) => boolean;
  readonly includeGenericBaselines?: boolean;
  readonly extra?: readonly {
    readonly name: string;
    readonly equal: (left: T, right: T) => boolean;
  }[];
}

export function registerEqualScenario<T>(scenario: EqualScenario<T>): void {
  bench(`JIT equal / ${scenario.name}`, () => {
    do_not_optimize(scenario.jitEqual(scenario.left, scenario.right));
  });

  if (scenario.includeGenericBaselines !== false) {
    bench(`fast-deep-equal / ${scenario.name}`, () => {
      do_not_optimize(fastEqual(scenario.left, scenario.right));
    });

    bench(`lodash.isEqual / ${scenario.name}`, () => {
      do_not_optimize(lodashEqual(scenario.left, scenario.right));
    });
  }

  for (const extra of scenario.extra ?? []) {
    bench(`${extra.name} / ${scenario.name}`, () => {
      do_not_optimize(extra.equal(scenario.left, scenario.right));
    });
  }
}

export function range(length: number): number[] {
  const out = new Array<number>(length);

  for (let i = 0; i < length; i++) out[i] = i;

  return out;
}
