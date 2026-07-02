import type { IRNode, IRProgram } from "../../ir.js";

export function loopSimplify(program: IRProgram): IRProgram {
  return { ...program, body: simplifyNodes(program.body) };
}

function simplifyNodes(nodes: readonly IRNode[]): readonly IRNode[] {
  const out: IRNode[] = [];

  for (const node of nodes) {
    if (node.kind === "if") {
      const then = simplifyNodes(node.then);
      const otherwise = node.otherwise ? simplifyNodes(node.otherwise) : undefined;

      if (then.length === 0 && (!otherwise || otherwise.length === 0)) continue;

      out.push({ ...node, then, ...(otherwise && otherwise.length > 0 ? { otherwise } : {}) });
      continue;
    }

    if (node.kind === "for") {
      const body = simplifyNodes(node.body);

      if (body.length === 0) continue;

      out.push({ ...node, body });
      continue;
    }

    if (node.kind === "block") {
      out.push(...simplifyNodes(node.body));
      continue;
    }

    if (node.kind === "map_equal" || node.kind === "binary_search_equal") {
      out.push({ ...node, body: simplifyNodes(node.body) });
      continue;
    }

    out.push(node);
  }

  return out;
}
