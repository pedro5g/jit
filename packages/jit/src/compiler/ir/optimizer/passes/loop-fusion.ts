import type { IRExpr, IRNode, IRProgram } from "../../ir.js";

export function loopFusion(program: IRProgram): IRProgram {
  return { ...program, body: fuseNodes(program.body) };
}

function fuseNodes(nodes: readonly IRNode[]): readonly IRNode[] {
  const out: IRNode[] = [];
  let ix = 0;

  while (ix < nodes.length) {
    const current = rewriteChildLoops(nodes[ix]);
    const next = nodes[ix + 1] ? rewriteChildLoops(nodes[ix + 1]) : undefined;

    if (current.kind === "for" && next?.kind === "for" && canFuse(current, next)) {
      out.push({ ...current, body: [...current.body, ...next.body] });
      ix += 2;
      continue;
    }

    out.push(current);
    ix++;
  }

  return out;
}

function rewriteChildLoops(node: IRNode): IRNode {
  if (node.kind === "if") {
    return {
      ...node,
      then: fuseNodes(node.then),
      ...(node.otherwise ? { otherwise: fuseNodes(node.otherwise) } : {}),
    };
  }

  if (node.kind === "for") return { ...node, body: fuseNodes(node.body) };

  return node;
}

function canFuse(
  left: Extract<IRNode, { readonly kind: "for" }>,
  right: Extract<IRNode, { readonly kind: "for" }>
): boolean {
  return (
    left.index.name === right.index.name &&
    exprKey(left.from) === exprKey(right.from) &&
    !hasControlFlowOrCall(left.body) &&
    !hasControlFlowOrCall(right.body)
  );
}

function hasControlFlowOrCall(nodes: readonly IRNode[]): boolean {
  for (const node of nodes) {
    if (node.kind === "return") return true;
    if (node.kind === "assign" && hasCall(node.expr)) return true;
    if (node.kind === "if") return true;
    if (node.kind === "for") return true;
  }

  return false;
}

function hasCall(expr: IRExpr): boolean {
  switch (expr.kind) {
    case "call":
      return true;
    case "not":
      return hasCall(expr.expr);
    case "binary":
    case "sameValue":
    case "sameNumber":
      return hasCall(expr.left) || hasCall(expr.right);
    case "schema_guard":
      return hasCall(expr.value);
    case "load_prop":
      return hasCall(expr.base);
    case "load_index":
      return hasCall(expr.base) || hasCall(expr.index);
    case "literal":
    case "var":
      return false;
  }
}

function exprKey(expr: IRExpr): string {
  switch (expr.kind) {
    case "var":
      return expr.name;
    case "literal":
      return String(expr.value);
    case "load_prop":
      return `${exprKey(expr.base)}.${expr.key}`;
    case "load_index":
      return `${exprKey(expr.base)}[${exprKey(expr.index)}]`;
    case "schema_guard":
      return `guard(${exprKey(expr.value)})`;
    default:
      return expr.kind;
  }
}
