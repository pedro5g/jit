import type { IRExpr, IRNode, IRProgram } from "../../ir.js";

export function inlineVars(program: IRProgram): IRProgram {
  const usages = new Map<string, number>();

  collectUsages(program.body, usages);

  return { ...program, body: inlineNodes(program.body, usages, new Map()) };
}

function inlineNodes(
  nodes: readonly IRNode[],
  usages: ReadonlyMap<string, number>,
  replacements: ReadonlyMap<string, IRExpr>
): readonly IRNode[] {
  const out: IRNode[] = [];
  const localReplacements = new Map(replacements);

  for (const node of nodes) {
    if (node.kind === "assign") {
      const expr = replaceExpr(node.expr, localReplacements);

      if ((usages.get(node.target.name) ?? 0) === 1 && isInlineSafe(expr)) {
        localReplacements.set(node.target.name, expr);
        continue;
      }

      out.push({ ...node, expr });
      continue;
    }

    if (node.kind === "if") {
      out.push({
        ...node,
        test: replaceExpr(node.test, localReplacements),
        then: inlineNodes(node.then, usages, localReplacements),
        ...(node.otherwise ? { otherwise: inlineNodes(node.otherwise, usages, localReplacements) } : {}),
      });
      continue;
    }

    if (node.kind === "for") {
      out.push({
        ...node,
        from: replaceExpr(node.from, localReplacements),
        body: inlineNodes(node.body, usages, new Map()),
      });
      continue;
    }

    if (node.kind === "hash_compare") {
      out.push({
        ...node,
        leftHash: replaceExpr(node.leftHash, localReplacements),
        rightHash: replaceExpr(node.rightHash, localReplacements),
      });
      continue;
    }

    if (node.kind === "map_equal" || node.kind === "binary_search_equal") {
      out.push({
        ...node,
        left: replaceExpr(node.left, localReplacements),
        right: replaceExpr(node.right, localReplacements),
        body: inlineNodes(node.body, usages, new Map()),
      });
      continue;
    }

    if (node.kind === "return") {
      out.push({ ...node, value: replaceExpr(node.value, localReplacements) });
      continue;
    }

    out.push(node);
  }

  return out;
}

function collectUsages(nodes: readonly IRNode[], usages: Map<string, number>): void {
  for (const node of nodes) {
    if (node.kind === "assign") collectExprUsages(node.expr, usages);
    if (node.kind === "if") {
      collectExprUsages(node.test, usages);
      collectUsages(node.then, usages);
      if (node.otherwise) collectUsages(node.otherwise, usages);
    }
    if (node.kind === "for") {
      collectExprUsages(node.from, usages);
      collectUsages(node.body, usages);
    }
    if (node.kind === "hash_compare") {
      collectExprUsages(node.leftHash, usages);
      collectExprUsages(node.rightHash, usages);
    }
    if (node.kind === "map_equal" || node.kind === "binary_search_equal") {
      collectExprUsages(node.left, usages);
      collectExprUsages(node.right, usages);
      collectUsages(node.body, usages);
    }
    if (node.kind === "return") collectExprUsages(node.value, usages);
  }
}

function collectExprUsages(expr: IRExpr, usages: Map<string, number>): void {
  switch (expr.kind) {
    case "var":
      usages.set(expr.name, (usages.get(expr.name) ?? 0) + 1);
      return;
    case "not":
      collectExprUsages(expr.expr, usages);
      return;
    case "binary":
    case "sameValue":
      collectExprUsages(expr.left, usages);
      collectExprUsages(expr.right, usages);
      return;
    case "sameNumber":
      collectExprUsages(expr.left, usages);
      collectExprUsages(expr.right, usages);
      collectExprUsages(expr.left, usages);
      collectExprUsages(expr.right, usages);
      return;
    case "schema_guard":
      collectExprUsages(expr.value, usages);
      return;
    case "load_prop":
      collectExprUsages(expr.base, usages);
      return;
    case "load_index":
      collectExprUsages(expr.base, usages);
      collectExprUsages(expr.index, usages);
      return;
    case "call":
      collectExprUsages(expr.callee, usages);
      for (const arg of expr.args) collectExprUsages(arg, usages);
      return;
    case "literal":
      return;
  }
}

function replaceExpr(expr: IRExpr, replacements: ReadonlyMap<string, IRExpr>): IRExpr {
  switch (expr.kind) {
    case "var":
      return replacements.get(expr.name) ?? expr;
    case "not":
      return { ...expr, expr: replaceExpr(expr.expr, replacements) };
    case "binary":
    case "sameValue":
    case "sameNumber":
      return { ...expr, left: replaceExpr(expr.left, replacements), right: replaceExpr(expr.right, replacements) };
    case "schema_guard":
      return { ...expr, value: replaceExpr(expr.value, replacements) };
    case "load_prop":
      return { ...expr, base: replaceExpr(expr.base, replacements) };
    case "load_index":
      return { ...expr, base: replaceExpr(expr.base, replacements), index: replaceExpr(expr.index, replacements) };
    case "call":
      return {
        ...expr,
        callee: replaceExpr(expr.callee, replacements),
        args: expr.args.map((arg) => replaceExpr(arg, replacements)),
      };
    case "literal":
      return expr;
  }
}

function isInlineSafe(expr: IRExpr): boolean {
  switch (expr.kind) {
    case "var":
    case "literal":
      return true;
    case "load_prop":
      return isInlineSafe(expr.base);
    case "load_index":
      return isInlineSafe(expr.base) && isInlineSafe(expr.index);
    case "not":
      return isInlineSafe(expr.expr);
    case "binary":
    case "sameValue":
    case "sameNumber":
      return isInlineSafe(expr.left) && isInlineSafe(expr.right);
    case "schema_guard":
      return isInlineSafe(expr.value);
    case "call":
      return false;
  }
}
