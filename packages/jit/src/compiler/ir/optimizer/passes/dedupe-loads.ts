import type { IRExpr, IRNode, IRProgram, IRVar } from "../../ir.js";

export function dedupeLoads(program: IRProgram): IRProgram {
  return { ...program, body: dedupeNodes(program.body, new Map()) };
}

function dedupeNodes(nodes: readonly IRNode[], loads: Map<string, IRVar>): readonly IRNode[] {
  const out: IRNode[] = [];

  for (const node of nodes) {
    if (node.kind === "assign" && (node.expr.kind === "load_prop" || node.expr.kind === "load_index")) {
      const key = loadKey(node.expr);

      if (key) {
        const existing = loads.get(key);

        if (existing) {
          out.push({ ...node, expr: existing });
          continue;
        }

        loads.set(key, node.target);
      }
    }

    if (node.kind === "if") {
      const next: IRNode = {
        ...node,
        then: dedupeNodes(node.then, new Map(loads)),
        ...(node.otherwise ? { otherwise: dedupeNodes(node.otherwise, new Map(loads)) } : {}),
      };
      out.push(next);
      continue;
    }

    if (node.kind === "for") {
      out.push({ ...node, body: dedupeNodes(node.body, new Map()) });
      continue;
    }

    if (node.kind === "map_equal" || node.kind === "binary_search_equal") {
      out.push({ ...node, body: dedupeNodes(node.body, new Map()) });
      continue;
    }

    out.push(node);
  }

  return out;
}

function loadKey(expr: IRExpr): string | undefined {
  if (expr.kind === "load_prop") return `${exprKey(expr.base)}.${expr.key}`;
  if (expr.kind === "load_index") return `${exprKey(expr.base)}[${exprKey(expr.index)}]`;
  return undefined;
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
