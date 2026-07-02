import { type IRExpr, type IRNode, type IRProgram, type IRVar, loadProp } from "../../ir.js";

export function hoistLoads(program: IRProgram): IRProgram {
  const usedNames = new Set<string>(program.params.map((param) => param.name));

  collectNodeNames(program.body, usedNames);

  return { ...program, body: hoistNodes(program.body, usedNames) };
}

function hoistNodes(nodes: readonly IRNode[], usedNames: Set<string>): readonly IRNode[] {
  const out: IRNode[] = [];

  for (const node of nodes) {
    if (node.kind === "assign") {
      const hoisted: IRNode[] = [];
      const expr = hoistExpr(node.expr, hoisted, usedNames);
      out.push(...hoisted, { ...node, expr });
      continue;
    }

    if (node.kind === "if") {
      out.push({
        ...node,
        then: hoistNodes(node.then, usedNames),
        ...(node.otherwise ? { otherwise: hoistNodes(node.otherwise, usedNames) } : {}),
      });
      continue;
    }

    if (node.kind === "for") {
      out.push({ ...node, body: hoistNodes(node.body, usedNames) });
      continue;
    }

    if (node.kind === "map_equal" || node.kind === "binary_search_equal") {
      out.push({ ...node, body: hoistNodes(node.body, usedNames) });
      continue;
    }

    out.push(node);
  }

  return out;
}

function hoistExpr(expr: IRExpr, hoisted: IRNode[], usedNames: Set<string>): IRExpr {
  if (expr.kind === "load_prop" && expr.base.kind === "load_prop") {
    const target = createHoistedVar(expr.base, usedNames);
    hoisted.push({ kind: "assign", target, expr: expr.base });
    return loadProp(target, expr.key);
  }

  return expr;
}

function createHoistedVar(expr: Extract<IRExpr, { readonly kind: "load_prop" }>, usedNames: Set<string>): IRVar {
  let name = loadName(expr);
  let suffix = 1;

  while (usedNames.has(name)) {
    name = `${loadName(expr)}${suffix++}`;
  }

  usedNames.add(name);
  return { kind: "var", name };
}

function loadName(expr: Extract<IRExpr, { readonly kind: "load_prop" }>): string {
  return `${exprName(expr.base)}_${expr.key}`.replace(/[^$_a-zA-Z0-9]/g, "_").replace(/^[^$_a-zA-Z]/, "_");
}

function exprName(expr: IRExpr): string {
  if (expr.kind === "var") return expr.name;
  if (expr.kind === "load_prop") return loadName(expr);
  return expr.kind;
}

function collectNodeNames(nodes: readonly IRNode[], names: Set<string>): void {
  for (const node of nodes) {
    if (node.kind === "assign") names.add(node.target.name);
    if (node.kind === "if") {
      collectNodeNames(node.then, names);
      if (node.otherwise) collectNodeNames(node.otherwise, names);
    }
    if (node.kind === "for") {
      names.add(node.index.name);
      collectNodeNames(node.body, names);
    }
    if (node.kind === "map_equal") {
      names.add(node.length.name);
      names.add(node.index.name);
      names.add(node.leftItem.name);
      names.add(node.rightItem.name);
      names.add(node.rightIndex.name);
      collectNodeNames(node.body, names);
    }
    if (node.kind === "binary_search_equal") {
      names.add(node.length.name);
      names.add(node.index.name);
      names.add(node.leftItem.name);
      names.add(node.rightItem.name);
      names.add(node.searchLow.name);
      names.add(node.searchHigh.name);
      names.add(node.searchMid.name);
      names.add(node.found.name);
      collectNodeNames(node.body, names);
    }
  }
}
