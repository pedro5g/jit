import type { IRExpr, IRNode, IRProgram } from "../../ir.js";

export function eliminateDead(program: IRProgram): IRProgram {
  return { ...program, body: eliminateNodes(program.body) };
}

function eliminateNodes(nodes: readonly IRNode[]): readonly IRNode[] {
  const out: IRNode[] = [];

  for (const node of nodes) {
    if (node.kind === "if" && isAlwaysFalse(node.test)) continue;

    if (node.kind === "if") {
      out.push({
        ...node,
        then: eliminateNodes(node.then),
        ...(node.otherwise ? { otherwise: eliminateNodes(node.otherwise) } : {}),
      });
      continue;
    }

    if (node.kind === "for") {
      out.push({ ...node, body: eliminateNodes(node.body) });
      continue;
    }

    if (node.kind === "map_equal" || node.kind === "binary_search_equal") {
      out.push({ ...node, body: eliminateNodes(node.body) });
      continue;
    }

    out.push(node);
  }

  return out;
}

function isAlwaysFalse(expr: IRExpr): boolean {
  return expr.kind === "not" && expr.expr.kind === "literal" && expr.expr.value === true;
}
