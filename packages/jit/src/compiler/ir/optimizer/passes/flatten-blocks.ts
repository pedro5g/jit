import type { IRNode, IRProgram } from "../../ir.js";

export function flattenBlocks(program: IRProgram): IRProgram {
  return { ...program, body: flattenNodes(program.body) };
}

function flattenNodes(nodes: readonly IRNode[]): readonly IRNode[] {
  const out: IRNode[] = [];

  for (const node of nodes) {
    if (node.kind === "block") {
      out.push(...flattenNodes(node.body));
      continue;
    }

    if (node.kind === "if") {
      const next: IRNode = {
        ...node,
        then: flattenNodes(node.then),
        ...(node.otherwise ? { otherwise: flattenNodes(node.otherwise) } : {}),
      };
      out.push(next);
      continue;
    }

    if (node.kind === "for") {
      out.push({ ...node, body: flattenNodes(node.body) });
      continue;
    }

    if (node.kind === "map_equal" || node.kind === "binary_search_equal") {
      out.push({ ...node, body: flattenNodes(node.body) });
      continue;
    }

    out.push(node);
  }

  return out;
}
