import { type IRExpr, type IRNode, type IRProgram, mapExprChildren, mapNodeBodies, mapNodeExprs } from "../../ir.js";
import { exprCost } from "../cost/expr-cost.js";

/**
 * Stable-sorts and/or operands so the cheapest checks run (and short-circuit)
 * first. Operands are pure field/binding comparisons in query IR, so
 * reordering preserves semantics; equal-cost operands keep source order.
 */
export function reorderConditions(program: IRProgram): IRProgram {
  return { ...program, body: reorderNodes(program.body) };
}

function reorderNodes(nodes: readonly IRNode[]): readonly IRNode[] {
  return nodes.map((node) => mapNodeExprs(mapNodeBodies(node, reorderNodes), reorderExpr));
}

function reorderExpr(expr: IRExpr): IRExpr {
  const next = mapExprChildren(expr, reorderExpr);

  if (next.kind !== "nary" || next.operands.length < 2) return next;

  const ranked = next.operands.map((operand, index) => ({ operand, index, cost: exprCost(operand) }));

  ranked.sort((left, right) => left.cost - right.cost || left.index - right.index);

  return { ...next, operands: ranked.map((entry) => entry.operand) };
}
