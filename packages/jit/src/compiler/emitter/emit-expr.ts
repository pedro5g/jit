import type { IRExpr } from "../ir/ir.js";
import { emitIndexAccess, emitPropertyAccess } from "../source/access.js";
import { emitSchemaGuard } from "../source/guard.js";
import { emitLiteral } from "../source/literal.js";

const BINARY_OPERATORS = {
  strictEqual: "===",
  notStrictEqual: "!==",
  or: "||",
  and: "&&",
  add: "+",
  divide: "/",
  greaterThan: ">",
  greaterThanOrEqual: ">=",
  lessThan: "<",
  lessThanOrEqual: "<=",
} as const;

const COMPARISON_OPERATORS = new Set([
  "strictEqual",
  "notStrictEqual",
  "greaterThan",
  "greaterThanOrEqual",
  "lessThan",
  "lessThanOrEqual",
]);

export function emitExpr(expr: IRExpr): string {
  switch (expr.kind) {
    case "var":
      return expr.name;
    case "literal":
      return emitLiteral(expr.value);
    case "not":
      return `!(${emitExpr(expr.expr)})`;
    case "binary":
      return `(${emitExpr(expr.left)} ${BINARY_OPERATORS[expr.op]} ${emitExpr(expr.right)})`;
    case "nary":
      return `(${expr.operands.map(emitConditionRaw).join(expr.op === "and" ? " && " : " || ")})`;
    case "sameValue":
      return `Object.is(${emitExpr(expr.left)}, ${emitExpr(expr.right)})`;
    case "sameNumber": {
      const left = emitExpr(expr.left);
      const right = emitExpr(expr.right);
      return `(${left} === ${right} || (${left} !== ${left} && ${right} !== ${right}))`;
    }
    case "schema_guard":
      return emitSchemaGuard(expr.schema, emitExpr(expr.value));
    case "load_prop":
      return emitPropertyAccess(emitExpr(expr.base), expr.key);
    case "load_index":
      return emitIndexAccess(emitExpr(expr.base), emitExpr(expr.index));
    case "call":
      return `${emitExpr(expr.callee)}(${expr.args.map(emitExpr).join(", ")})`;
    case "object_literal": {
      if (expr.entries.length === 0) return "{}";
      const entries = expr.entries.map((entry) => `${emitLiteral(entry.key)}: ${emitExpr(entry.value)}`);
      return `{ ${entries.join(", ")} }`;
    }
    case "array_literal":
      return `[${expr.elements.map(emitExpr).join(", ")}]`;
    case "construct":
      return `new ${expr.ctor}(${expr.args.map(emitExpr).join(", ")})`;
  }
}

/**
 * Emits a boolean condition without the outer parentheses `emitExpr` adds
 * around binary comparisons, matching hand-written condition style:
 * `a === b`, `(a === b && c > d)`, `!(a === b)`.
 */
export function emitConditionRaw(expr: IRExpr): string {
  if (expr.kind === "binary" && COMPARISON_OPERATORS.has(expr.op)) {
    return `${emitExpr(expr.left)} ${BINARY_OPERATORS[expr.op]} ${emitExpr(expr.right)}`;
  }

  if (expr.kind === "not") {
    return `!(${emitConditionRaw(expr.expr)})`;
  }

  return emitExpr(expr);
}
