import type { IRExpr } from "../../ir.js";

/**
 * Static evaluation-cost model for query conditions. Drives cheap-first
 * ordering of pure boolean operands; equal-specific passes keep their own
 * tuned tables.
 */
export function exprCost(expr: IRExpr): number {
  switch (expr.kind) {
    case "literal":
    case "var":
      return 1;
    case "load_prop":
      return 2 + exprCost(expr.base);
    case "load_index":
      return 4 + exprCost(expr.base) + exprCost(expr.index);
    case "not":
      return exprCost(expr.expr);
    case "binary":
    case "sameValue":
      return 1 + exprCost(expr.left) + exprCost(expr.right);
    case "sameNumber":
      return 20;
    case "nary":
      return 1 + expr.operands.reduce((total, operand) => total + exprCost(operand), 0);
    case "schema_guard":
      return 10 + exprCost(expr.value);
    case "call":
      return 100;
    case "object_literal":
    case "array_literal":
    case "construct":
      return 50;
  }
}
