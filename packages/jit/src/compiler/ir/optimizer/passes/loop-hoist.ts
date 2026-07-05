import type { IRExpr, IRNode, IRProgram } from "../../ir.js";

export function loopHoist(program: IRProgram): IRProgram {
  return { ...program, body: hoistLoopInvariants(program.body) };
}

function hoistLoopInvariants(nodes: readonly IRNode[]): readonly IRNode[] {
  const out: IRNode[] = [];

  for (const node of nodes) {
    if (node.kind === "for") {
      const before: IRNode[] = [];
      const body: IRNode[] = [];
      const loopLocals = collectAssignedNames(node.body);

      for (const child of node.body) {
        if (
          child.kind === "assign" &&
          !referencesVar(child.expr, node.index.name) &&
          !referencesAny(child.expr, loopLocals)
        ) {
          before.push(child);
          continue;
        }

        body.push(child);
      }

      out.push(...before, { ...node, body: hoistLoopInvariants(body) });
      continue;
    }

    if (node.kind === "if") {
      out.push({
        ...node,
        then: hoistLoopInvariants(node.then),
        ...(node.otherwise ? { otherwise: hoistLoopInvariants(node.otherwise) } : {}),
      });
      continue;
    }

    if (node.kind === "map_equal" || node.kind === "binary_search_equal") {
      out.push({ ...node, body: hoistLoopInvariants(node.body) });
      continue;
    }

    out.push(node);
  }

  return out;
}

function collectAssignedNames(nodes: readonly IRNode[]): ReadonlySet<string> {
  const names = new Set<string>();

  for (const node of nodes) {
    if (node.kind === "assign") names.add(node.target.name);
    if (node.kind === "for") {
      names.add(node.index.name);
      for (const name of collectAssignedNames(node.body)) names.add(name);
    }
    if (node.kind === "if") {
      for (const name of collectAssignedNames(node.then)) names.add(name);
      if (node.otherwise) {
        for (const name of collectAssignedNames(node.otherwise)) names.add(name);
      }
    }
    if (node.kind === "map_equal" || node.kind === "binary_search_equal") {
      for (const name of collectAssignedNames(node.body)) names.add(name);
    }
  }

  return names;
}

function referencesAny(expr: IRExpr, names: ReadonlySet<string>): boolean {
  for (const name of names) {
    if (referencesVar(expr, name)) return true;
  }

  return false;
}

function referencesVar(expr: IRExpr, name: string): boolean {
  switch (expr.kind) {
    case "var":
      return expr.name === name;
    case "not":
      return referencesVar(expr.expr, name);
    case "binary":
    case "sameValue":
    case "sameNumber":
      return referencesVar(expr.left, name) || referencesVar(expr.right, name);
    case "schema_guard":
      return referencesVar(expr.value, name);
    case "load_prop":
      return referencesVar(expr.base, name);
    case "load_index":
      return referencesVar(expr.base, name) || referencesVar(expr.index, name);
    case "call":
      return referencesVar(expr.callee, name) || expr.args.some((arg) => referencesVar(arg, name));
    case "nary":
      return expr.operands.some((operand) => referencesVar(operand, name));
    case "object_literal":
      return expr.entries.some((entry) => referencesVar(entry.value, name));
    case "array_literal":
      return expr.elements.some((element) => referencesVar(element, name));
    case "construct":
      return expr.args.some((arg) => referencesVar(arg, name));
    case "literal":
      return false;
  }
}
