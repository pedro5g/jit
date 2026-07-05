import type { IRProgram } from "../ir.js";
import { optimizeCost } from "./cost/optimize-cost.js";
import { dedupeLoads } from "./passes/dedupe-loads.js";
import { eliminateDead } from "./passes/eliminate-dead.js";
import { flattenBlocks } from "./passes/flatten-blocks.js";
import { hoistArrayElements } from "./passes/hoist-array-elements.js";
import { hoistLoads } from "./passes/hoist-loads.js";
import { inlineVars } from "./passes/inline-vars.js";
import { loopFusion } from "./passes/loop-fusion.js";
import { loopHoist } from "./passes/loop-hoist.js";
import { loopSimplify } from "./passes/loop-simplify.js";
import { normalizeLogic } from "./passes/normalize-logic.js";
import { reorderCompares } from "./passes/reorder-compares.js";
import { reorderConditions } from "./passes/reorder-conditions.js";

export const optimizeEqualIRPasses = [
  flattenBlocks,
  dedupeLoads,
  hoistLoads,
  loopFusion,
  loopHoist,
  hoistArrayElements,
  loopSimplify,
  eliminateDead,
  optimizeCost,
  inlineVars,
  reorderCompares,
] as const;

export type IRPass = (program: IRProgram) => IRProgram;

export function optimizeIRWith(program: IRProgram, passes: readonly IRPass[]): IRProgram {
  let next = program;

  for (const pass of passes) {
    next = pass(next);
  }

  return next;
}

export function optimizeIR(program: IRProgram): IRProgram {
  return optimizeIRWith(program, optimizeEqualIRPasses);
}

export const optimizeQueryIRPasses = [flattenBlocks, normalizeLogic, reorderConditions] as const;

export function optimizeQueryIR(program: IRProgram): IRProgram {
  return optimizeIRWith(program, optimizeQueryIRPasses);
}
