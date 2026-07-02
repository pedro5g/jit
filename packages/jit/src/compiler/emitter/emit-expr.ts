import type { IRExpr } from "../ir/ir.js";
import { emitIndexAccess, emitPropertyAccess } from "../source/access.js";
import { emitLiteral } from "../source/literal.js";

export function emitExpr(expr: IRExpr): string {
  switch (expr.kind) {
    case "var":
      return expr.name;
    case "literal":
      return emitLiteral(expr.value);
    case "not":
      return `!(${emitExpr(expr.expr)})`;
    case "binary": {
      const op =
        expr.op === "strictEqual" ? "===" : expr.op === "notStrictEqual" ? "!==" : expr.op === "add" ? "+" : "||";
      return `(${emitExpr(expr.left)} ${op} ${emitExpr(expr.right)})`;
    }
    case "sameValue":
      return `Object.is(${emitExpr(expr.left)}, ${emitExpr(expr.right)})`;
    case "sameNumber": {
      const left = emitExpr(expr.left);
      const right = emitExpr(expr.right);
      return `(${left} === ${right} || (${left} !== ${left} && ${right} !== ${right}))`;
    }
    case "load_prop":
      return emitPropertyAccess(emitExpr(expr.base), expr.key);
    case "load_index":
      return emitIndexAccess(emitExpr(expr.base), emitExpr(expr.index));
    case "call":
      return `${emitExpr(expr.callee)}(${expr.args.map(emitExpr).join(", ")})`;
  }
}
