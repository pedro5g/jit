import type { IRProgram } from "../ir.js";
import { optimizeCost } from "./cost/optimize-cost.js";
import { flattenBlocks } from "./passes/flatten-blocks.js";
import { inlineVars } from "./passes/inline-vars.js";
import { normalizeLogic } from "./passes/normalize-logic.js";
import { reorderCompares } from "./passes/reorder-compares.js";
import { reorderConditions } from "./passes/reorder-conditions.js";

/**
 * The passes that still earn their place.
 *
 * The equal builder emits hoisted, block-free, dead-code-free IR on its own,
 * so the load/loop/dead-code passes were re-measured against every container
 * kind, unions, hints, deep nesting and wide objects: they changed no output
 * at all while costing ~15µs per compile — two thirds of the pipeline. What
 * remains is what demonstrably rewrites something. V8 performs load
 * elimination and loop-invariant motion on the generated function anyway; the
 * value is in emitting good code, not in polishing it afterwards.
 *
 * Re-measure before adding one back: `optimizeIRWith(ir, [pass])` must produce
 * different source from `ir` on some real schema, or it is pure compile cost.
 */
export const optimizeEqualIRPasses = [flattenBlocks, optimizeCost, inlineVars, reorderCompares] as const;

/** Describes the JIT irpass contract used by the public API. */
export type IRPass = (program: IRProgram) => IRProgram;

/** Provides the JIT optimize irwith operation for the supplied input. */
export function optimizeIRWith(program: IRProgram, passes: readonly IRPass[]): IRProgram {
  let next = program;

  for (const pass of passes) {
    next = pass(next);
  }

  // Helpers are ordinary programs, so every pass applies to them too: a
  // recursive schema gets exactly the same optimization as an inlined one.
  if (!program.helpers || program.helpers.length === 0) return next;

  return {
    ...next,
    helpers: program.helpers.map((helper) => ({
      name: helper.name,
      program: optimizeIRWith(helper.program, passes),
    })),
  };
}

/** Provides the JIT optimize ir operation for the supplied input. */
export function optimizeIR(program: IRProgram): IRProgram {
  return optimizeIRWith(program, optimizeEqualIRPasses);
}

/** Provides the JIT optimize query irpasses configuration used by the public contract. */
export const optimizeQueryIRPasses = [flattenBlocks, normalizeLogic, reorderConditions] as const;

/** Provides the JIT optimize query ir operation for the supplied input. */
export function optimizeQueryIR(program: IRProgram): IRProgram {
  return optimizeIRWith(program, optimizeQueryIRPasses);
}
