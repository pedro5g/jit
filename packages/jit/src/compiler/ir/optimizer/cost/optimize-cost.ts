import type { IRExpr, IRNode, IRProgram } from "../../ir.js";

export function optimizeCost(program: IRProgram): IRProgram {
  return { ...program, body: optimizeNodes(program.body) };
}

function optimizeNodes(nodes: readonly IRNode[]): readonly IRNode[] {
  const out: IRNode[] = [];
  let run: IRNode[] = [];

  const flush = () => {
    if (run.length > 0) {
      out.push(...run.sort((left, right) => nodeCost(left) - nodeCost(right)));
      run = [];
    }
  };

  for (const node of nodes) {
    if (isPureFailureCheck(node)) {
      run.push(node);
      continue;
    }

    flush();

    if (node.kind === "if") {
      out.push({
        ...node,
        then: optimizeNodes(node.then),
        ...(node.otherwise ? { otherwise: optimizeNodes(node.otherwise) } : {}),
      });
      continue;
    }

    if (node.kind === "for") {
      out.push({ ...node, body: optimizeNodes(node.body) });
      continue;
    }

    if (node.kind === "map_equal" || node.kind === "binary_search_equal") {
      out.push({ ...node, body: optimizeNodes(node.body) });
      continue;
    }

    out.push(node);
  }

  flush();
  return out;
}

function isPureFailureCheck(node: IRNode): boolean {
  return (
    node.kind === "if" &&
    node.then.length === 1 &&
    node.then[0].kind === "return" &&
    node.then[0].value.kind === "literal" &&
    node.then[0].value.value === false &&
    isPureExpr(node.test)
  );
}

function isPureExpr(expr: IRExpr): boolean {
  switch (expr.kind) {
    case "var":
    case "literal":
      return true;
    case "not":
      return isPureExpr(expr.expr);
    case "binary":
    case "sameValue":
      return isPureExpr(expr.left) && isPureExpr(expr.right);
    case "sameNumber":
      return false;
    case "schema_guard":
      return isPureExpr(expr.value);
    case "load_prop":
      return isPureExpr(expr.base);
    case "load_index":
      return isPureExpr(expr.base) && isPureExpr(expr.index);
    case "call":
      return false;
  }
}

function nodeCost(node: IRNode): number {
  return node.kind === "if" ? exprCost(node.test) : 0;
}

function exprCost(expr: IRExpr): number {
  switch (expr.kind) {
    case "literal":
    case "var":
      return 1;
    case "load_prop":
      return 2 + exprCost(expr.base);
    case "load_index":
      return 4 + exprCost(expr.base) + exprCost(expr.index);
    case "not":
      return exprCost(expr.expr);
    case "binary":
    case "sameValue":
      return 1 + exprCost(expr.left) + exprCost(expr.right);
    case "sameNumber":
      return 20;
    case "schema_guard":
      return 10 + exprCost(expr.value);
    case "call":
      return 100;
  }
}
