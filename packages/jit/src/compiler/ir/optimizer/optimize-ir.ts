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
import { reorderCompares } from "./passes/reorder-compares.js";

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

export function optimizeIR(program: IRProgram): IRProgram {
  let next = program;

  for (const pass of optimizeEqualIRPasses) {
    next = pass(next);
  }

  return next;
}
