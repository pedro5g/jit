import type { IRExpr, IRNode, IRProgram, IRVar } from "../../ir.js";

export function hoistArrayElements(program: IRProgram): IRProgram {
  return { ...program, body: rewriteNodes(program.body) };
}

function rewriteNodes(nodes: readonly IRNode[]): readonly IRNode[] {
  return nodes.map((node) => {
    if (node.kind === "for") return { ...node, body: dedupeIndexLoads(node.body, new Map()) };
    if (node.kind === "if") {
      return {
        ...node,
        then: rewriteNodes(node.then),
        ...(node.otherwise ? { otherwise: rewriteNodes(node.otherwise) } : {}),
      };
    }
    if (node.kind === "map_equal" || node.kind === "binary_search_equal")
      return { ...node, body: rewriteNodes(node.body) };
    return node;
  });
}

function dedupeIndexLoads(nodes: readonly IRNode[], loads: Map<string, IRVar>): readonly IRNode[] {
  const out: IRNode[] = [];

  for (const node of nodes) {
    if (node.kind === "assign" && node.expr.kind === "load_index") {
      const key = `${exprKey(node.expr.base)}[${exprKey(node.expr.index)}]`;
      const existing = loads.get(key);

      if (existing) {
        out.push({ ...node, expr: existing });
        continue;
      }

      loads.set(key, node.target);
    }

    out.push(node);
  }

  return out;
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
    default:
      return expr.kind;
  }
}
