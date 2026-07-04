import { bench, do_not_optimize, group } from "mitata";

/**
 * A competitor implementation measured against the JIT-compiled function.
 *
 * `biased` marks a comparison that is not apples-to-apples (handwritten O(n²)
 * baseline, competitor doing less work, pre-converted inputs, ...). The reason
 * is appended to the bench name as `[not comparable]` and persisted with the
 * results so `bench/report.ts` can exclude the entry from win/loss ratios.
 *
 * `fn` is intentionally loosely typed (`never[]` rest accepts any function):
 * scenarios mix compiled functions, library functions, and pre-bound thunks
 * with heterogeneous signatures, and every function is exercised at runtime by
 * the bench itself.
 */
export interface Competitor {
  readonly name: string;
  readonly fn: (...args: never[]) => unknown;
  readonly biased?: string;
}

export interface Scenario {
  /** Operation label: `"equal"` produces bench names like `JIT equal / <name>`. */
  readonly op: string;
  readonly name: string;
  /** Shared inputs passed to the JIT function and to every competitor. */
  readonly args: readonly unknown[];
  readonly jit: (...args: never[]) => unknown;
  readonly competitors: readonly Competitor[];
}

/** bench name → bias reason; consumed by `persist.ts` when writing results. */
export const biasRegistry = new Map<string, string>();

/**
 * bench name → scenario key (`"<op> / <name>"`); consumed by `persist.ts`.
 * Scenario names alone are not unique across operations (e.g. pick and omit
 * both use "medium object"), so reports must group by this key, not by name.
 */
export const scenarioRegistry = new Map<string, string>();

type AnyFn = (...args: readonly unknown[]) => unknown;

// Direct 1/2-arg calls keep the measured closure monomorphic; a generic
// `fn(...args)` spread would add per-iteration overhead to every scenario.
function toThunk(fn: Scenario["jit"], args: readonly unknown[]): () => void {
  const call = fn as AnyFn;

  if (args.length === 1) {
    const [a] = args;
    return () => {
      do_not_optimize((call as (a: unknown) => unknown)(a));
    };
  }

  if (args.length === 2) {
    const [a, b] = args;
    return () => {
      do_not_optimize((call as (a: unknown, b: unknown) => unknown)(a, b));
    };
  }

  return () => {
    do_not_optimize(call(...args));
  };
}

export function registerScenario(scenario: Scenario): void {
  const scenarioKey = `${scenario.op} / ${scenario.name}`;

  group(scenario.name, () => {
    const jitName = `JIT ${scenario.op} / ${scenario.name}`;
    scenarioRegistry.set(jitName, scenarioKey);
    bench(jitName, toThunk(scenario.jit, scenario.args));

    for (const competitor of scenario.competitors) {
      const marker = competitor.biased ? " [not comparable]" : "";
      const name = `${competitor.name}${marker} / ${scenario.name}`;

      if (competitor.biased) biasRegistry.set(name, competitor.biased);
      scenarioRegistry.set(name, scenarioKey);

      bench(name, toThunk(competitor.fn, scenario.args));
    }
  });
}
