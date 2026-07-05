import { type IRNode, type IRProgram, mapNodeBodies } from "../../ir.js";

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

    out.push(mapNodeBodies(node, flattenNodes));
  }

  return out;
}
