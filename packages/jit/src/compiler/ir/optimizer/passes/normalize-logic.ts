import {
  type IRExpr,
  type IRNode,
  type IRProgram,
  literal,
  mapExprChildren,
  mapNodeBodies,
  mapNodeExprs,
  not,
} from "../../ir.js";

/**
 * Normalizes boolean conditions: flattens nested and/or chains, removes
 * double negation, pushes `not` through and/or (De Morgan) and through
 * `===`/`!==`, folds boolean literals, and drops structurally duplicated
 * operands.
 *
 * `not` is NOT pushed through ordered comparisons (`>`, `>=`, `<`, `<=`):
 * `!(a > b)` and `a <= b` disagree when either side is NaN.
 */
export function normalizeLogic(program: IRProgram): IRProgram {
  return { ...program, body: normalizeNodes(program.body) };
}

function normalizeNodes(nodes: readonly IRNode[]): readonly IRNode[] {
  return nodes.map((node) => mapNodeExprs(mapNodeBodies(node, normalizeNodes), normalizeExpr));
}

function normalizeExpr(expr: IRExpr): IRExpr {
  const next = mapExprChildren(expr, normalizeExpr);

  if (next.kind === "not") return normalizeNot(next.expr);
  if (next.kind === "nary") return normalizeNary(next);
  if (next.kind === "binary" && next.left.kind === "literal" && next.right.kind === "literal") {
    return foldComparison(next.op, next.left.value, next.right.value) ?? next;
  }

  return next;
}

/**
 * Folds literal-vs-literal comparisons with the engine's own operators, so
 * the result matches what the emitted code would compute at runtime.
 */
function foldComparison(op: string, left: unknown, right: unknown): IRExpr | undefined {
  switch (op) {
    case "strictEqual":
      return literal(left === right);
    case "notStrictEqual":
      return literal(left !== right);
    case "greaterThan":
      return literal((left as never) > (right as never));
    case "greaterThanOrEqual":
      return literal((left as never) >= (right as never));
    case "lessThan":
      return literal((left as never) < (right as never));
    case "lessThanOrEqual":
      return literal((left as never) <= (right as never));
    default:
      return undefined;
  }
}

function normalizeNot(inner: IRExpr): IRExpr {
  if (inner.kind === "not") return inner.expr;

  if (inner.kind === "literal" && typeof inner.value === "boolean") return literal(!inner.value);

  if (inner.kind === "binary" && inner.op === "strictEqual") return { ...inner, op: "notStrictEqual" };
  if (inner.kind === "binary" && inner.op === "notStrictEqual") return { ...inner, op: "strictEqual" };

  if (inner.kind === "nary") {
    return normalizeNary({
      kind: "nary",
      op: inner.op === "and" ? "or" : "and",
      operands: inner.operands.map((operand) => normalizeExpr(not(operand))),
    });
  }

  return not(inner);
}

function normalizeNary(expr: Extract<IRExpr, { readonly kind: "nary" }>): IRExpr {
  const absorbing = expr.op !== "and";
  const neutral = !absorbing;
  const operands: IRExpr[] = [];
  const seen = new Set<string>();

  for (const operand of flattenOperands(expr.op, expr.operands)) {
    if (operand.kind === "literal" && typeof operand.value === "boolean") {
      if (operand.value === absorbing) return literal(absorbing);
      continue;
    }

    const key = exprKey(operand);

    if (seen.has(key)) continue;

    seen.add(key);
    operands.push(operand);
  }

  if (operands.length === 0) return literal(neutral);

  // Single-operand chains keep the nary wrapper: the query emitter renders
  // nary tests in filter-conjunction style and collapsing would reshape the
  // emitted condition.
  return { ...expr, operands };
}

function flattenOperands(op: "and" | "or", operands: readonly IRExpr[]): readonly IRExpr[] {
  const out: IRExpr[] = [];

  for (const operand of operands) {
    if (operand.kind === "nary" && operand.op === op) {
      out.push(...flattenOperands(op, operand.operands));
      continue;
    }

    out.push(operand);
  }

  return out;
}

const opaqueKeys = new WeakMap<object, number>();
let opaqueKeyCounter = 0;

function opaqueKey(value: object): number {
  let key = opaqueKeys.get(value);

  if (key === undefined) {
    key = ++opaqueKeyCounter;
    opaqueKeys.set(value, key);
  }

  return key;
}

/** Deterministic structural key; opaque values fall back to identity keys. */
function exprKey(expr: IRExpr): string {
  switch (expr.kind) {
    case "var":
      return `v:${expr.name}`;
    case "literal":
      return `l:${typeof expr.value}:${String(expr.value)}`;
    case "not":
      return `!(${exprKey(expr.expr)})`;
    case "binary":
      return `b:${expr.op}(${exprKey(expr.left)},${exprKey(expr.right)})`;
    case "nary":
      return `n:${expr.op}(${expr.operands.map(exprKey).join(",")})`;
    case "sameValue":
      return `sv(${exprKey(expr.left)},${exprKey(expr.right)})`;
    case "sameNumber":
      return `sn(${exprKey(expr.left)},${exprKey(expr.right)})`;
    case "schema_guard":
      return `g${opaqueKey(expr.schema)}(${exprKey(expr.value)})`;
    case "load_prop":
      return `${exprKey(expr.base)}.${expr.key}`;
    case "load_index":
      return `${exprKey(expr.base)}[${exprKey(expr.index)}]`;
    case "call":
      return `c:${exprKey(expr.callee)}(${expr.args.map(exprKey).join(",")})`;
    case "object_literal":
      return `o{${expr.entries.map((entry) => `${entry.key}:${exprKey(entry.value)}`).join(",")}}`;
    case "array_literal":
      return `a[${expr.elements.map(exprKey).join(",")}]`;
    case "construct":
      return `new:${expr.ctor}(${expr.args.map(exprKey).join(",")})`;
  }
}

export { exprKey as serializeIRExpr };
