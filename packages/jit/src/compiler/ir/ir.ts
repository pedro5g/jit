import type * as ATS from "../../core/ats/index.js";

export interface IRVar {
  readonly kind: "var";
  readonly name: string;
}

export type IRLiteralValue = string | number | bigint | boolean | null | undefined;

export type IRBinaryOperator =
  | "strictEqual"
  | "notStrictEqual"
  | "or"
  | "and"
  | "add"
  | "divide"
  | "greaterThan"
  | "greaterThanOrEqual"
  | "lessThan"
  | "lessThanOrEqual";

export type IRExpr =
  | IRVar
  | { readonly kind: "literal"; readonly value: IRLiteralValue }
  | { readonly kind: "not"; readonly expr: IRExpr }
  | {
      readonly kind: "binary";
      readonly op: IRBinaryOperator;
      readonly left: IRExpr;
      readonly right: IRExpr;
    }
  | { readonly kind: "nary"; readonly op: "and" | "or"; readonly operands: readonly IRExpr[] }
  | { readonly kind: "sameValue"; readonly left: IRExpr; readonly right: IRExpr }
  | { readonly kind: "sameNumber"; readonly left: IRExpr; readonly right: IRExpr }
  | { readonly kind: "schema_guard"; readonly schema: ATS.AnyTypeSchema; readonly value: IRExpr }
  | { readonly kind: "load_prop"; readonly base: IRExpr; readonly key: string }
  | { readonly kind: "load_index"; readonly base: IRExpr; readonly index: IRExpr }
  | { readonly kind: "call"; readonly callee: IRExpr; readonly args: readonly IRExpr[] }
  | {
      readonly kind: "object_literal";
      readonly entries: readonly { readonly key: string; readonly value: IRExpr }[];
    }
  | { readonly kind: "array_literal"; readonly elements: readonly IRExpr[] }
  | { readonly kind: "construct"; readonly ctor: string; readonly args: readonly IRExpr[] };

export type IRNode =
  | { readonly kind: "block"; readonly body: readonly IRNode[] }
  | { readonly kind: "assign"; readonly target: IRVar; readonly expr: IRExpr }
  | { readonly kind: "hash_compare"; readonly leftHash: IRExpr; readonly rightHash: IRExpr }
  | {
      readonly kind: "map_equal";
      readonly left: IRExpr;
      readonly right: IRExpr;
      readonly key: string;
      readonly length: IRVar;
      readonly index: IRVar;
      readonly leftItem: IRVar;
      readonly rightItem: IRVar;
      readonly rightIndex: IRVar;
      readonly body: readonly IRNode[];
    }
  | {
      readonly kind: "binary_search_equal";
      readonly left: IRExpr;
      readonly right: IRExpr;
      readonly key: string;
      readonly length: IRVar;
      readonly index: IRVar;
      readonly leftItem: IRVar;
      readonly rightItem: IRVar;
      readonly searchLow: IRVar;
      readonly searchHigh: IRVar;
      readonly searchMid: IRVar;
      readonly found: IRVar;
      readonly direction: "asc" | "desc" | undefined;
      readonly body: readonly IRNode[];
    }
  | {
      readonly kind: "if";
      readonly test: IRExpr;
      readonly then: readonly IRNode[];
      readonly otherwise?: readonly IRNode[];
    }
  | { readonly kind: "for"; readonly index: IRVar; readonly from: IRExpr; readonly body: readonly IRNode[] }
  | { readonly kind: "let"; readonly target: IRVar; readonly expr?: IRExpr }
  | { readonly kind: "store"; readonly target: IRExpr; readonly expr: IRExpr }
  | { readonly kind: "expr_stmt"; readonly expr: IRExpr }
  | {
      readonly kind: "for_range";
      readonly index: IRVar;
      readonly length: IRExpr;
      readonly body: readonly IRNode[];
    }
  | {
      readonly kind: "for_of";
      readonly item: IRVar;
      readonly iterable: IRExpr;
      readonly body: readonly IRNode[];
    }
  | { readonly kind: "append"; readonly target: IRVar; readonly cursor: IRVar; readonly value: IRExpr }
  | {
      readonly kind: "sort_by_key";
      readonly target: IRVar;
      readonly key: string;
      readonly direction: "asc" | "desc";
    }
  | { readonly kind: "return"; readonly value: IRExpr };

export interface IRProgram {
  readonly kind: "program";
  readonly params: readonly IRVar[];
  readonly body: readonly IRNode[];
}

export function irVar(name: string): IRVar {
  return { kind: "var", name };
}

export function literal(value: IRLiteralValue): IRExpr {
  return { kind: "literal", value };
}

export function not(expr: IRExpr): IRExpr {
  return { kind: "not", expr };
}

export function strictEqual(left: IRExpr, right: IRExpr): IRExpr {
  return { kind: "binary", op: "strictEqual", left, right };
}

export function notStrictEqual(left: IRExpr, right: IRExpr): IRExpr {
  return { kind: "binary", op: "notStrictEqual", left, right };
}

export function or(left: IRExpr, right: IRExpr): IRExpr {
  return { kind: "binary", op: "or", left, right };
}

export function add(left: IRExpr, right: IRExpr): IRExpr {
  return { kind: "binary", op: "add", left, right };
}

export function sameValue(left: IRExpr, right: IRExpr): IRExpr {
  return { kind: "sameValue", left, right };
}

export function sameNumber(left: IRExpr, right: IRExpr): IRExpr {
  return { kind: "sameNumber", left, right };
}

export function schemaGuard(schema: ATS.AnyTypeSchema, value: IRExpr): IRExpr {
  return { kind: "schema_guard", schema, value };
}

export function loadProp(base: IRExpr, key: string): IRExpr {
  return { kind: "load_prop", base, key };
}

export function loadIndex(base: IRExpr, index: IRExpr): IRExpr {
  return { kind: "load_index", base, index };
}

export function call(callee: IRExpr, args: readonly IRExpr[] = []): IRExpr {
  return { kind: "call", callee, args };
}

export function binary(op: IRBinaryOperator, left: IRExpr, right: IRExpr): IRExpr {
  return { kind: "binary", op, left, right };
}

export function allOf(operands: readonly IRExpr[]): IRExpr {
  return { kind: "nary", op: "and", operands };
}

export function anyOf(operands: readonly IRExpr[]): IRExpr {
  return { kind: "nary", op: "or", operands };
}

export function objectLiteral(entries: readonly { readonly key: string; readonly value: IRExpr }[]): IRExpr {
  return { kind: "object_literal", entries };
}

export function arrayLiteral(elements: readonly IRExpr[] = []): IRExpr {
  return { kind: "array_literal", elements };
}

export function construct(ctor: string, args: readonly IRExpr[] = []): IRExpr {
  return { kind: "construct", ctor, args };
}

export function letDecl(target: IRVar, expr?: IRExpr): IRNode {
  return expr === undefined ? { kind: "let", target } : { kind: "let", target, expr };
}

export function store(target: IRExpr, expr: IRExpr): IRNode {
  return { kind: "store", target, expr };
}

export function exprStmt(expr: IRExpr): IRNode {
  return { kind: "expr_stmt", expr };
}

export function forRange(index: IRVar, length: IRExpr, body: readonly IRNode[]): IRNode {
  return { kind: "for_range", index, length, body };
}

export function forOf(item: IRVar, iterable: IRExpr, body: readonly IRNode[]): IRNode {
  return { kind: "for_of", item, iterable, body };
}

export function append(target: IRVar, cursor: IRVar, value: IRExpr): IRNode {
  return { kind: "append", target, cursor, value };
}

export function sortByKey(target: IRVar, key: string, direction: "asc" | "desc"): IRNode {
  return { kind: "sort_by_key", target, key, direction };
}

/**
 * Rebuilds an expression with `mapExpr` applied to each direct child
 * expression. Leaf expressions are returned unchanged.
 */
export function mapExprChildren(expr: IRExpr, mapExpr: (child: IRExpr) => IRExpr): IRExpr {
  switch (expr.kind) {
    case "var":
    case "literal":
      return expr;
    case "not":
      return { ...expr, expr: mapExpr(expr.expr) };
    case "binary":
    case "sameValue":
    case "sameNumber":
      return { ...expr, left: mapExpr(expr.left), right: mapExpr(expr.right) };
    case "nary":
      return { ...expr, operands: expr.operands.map(mapExpr) };
    case "schema_guard":
      return { ...expr, value: mapExpr(expr.value) };
    case "load_prop":
      return { ...expr, base: mapExpr(expr.base) };
    case "load_index":
      return { ...expr, base: mapExpr(expr.base), index: mapExpr(expr.index) };
    case "call":
      return { ...expr, callee: mapExpr(expr.callee), args: expr.args.map(mapExpr) };
    case "object_literal":
      return { ...expr, entries: expr.entries.map((entry) => ({ ...entry, value: mapExpr(entry.value) })) };
    case "array_literal":
      return { ...expr, elements: expr.elements.map(mapExpr) };
    case "construct":
      return { ...expr, args: expr.args.map(mapExpr) };
  }
}

/**
 * Rebuilds a node with `mapExpr` applied to each expression the node holds
 * directly. Nested statement lists are untouched; combine with
 * `mapNodeBodies` to recurse.
 */
export function mapNodeExprs(node: IRNode, mapExpr: (expr: IRExpr) => IRExpr): IRNode {
  switch (node.kind) {
    case "assign":
      return { ...node, expr: mapExpr(node.expr) };
    case "let":
      return node.expr === undefined ? node : { ...node, expr: mapExpr(node.expr) };
    case "store":
      return { ...node, target: mapExpr(node.target), expr: mapExpr(node.expr) };
    case "expr_stmt":
      return { ...node, expr: mapExpr(node.expr) };
    case "hash_compare":
      return { ...node, leftHash: mapExpr(node.leftHash), rightHash: mapExpr(node.rightHash) };
    case "map_equal":
    case "binary_search_equal":
      return { ...node, left: mapExpr(node.left), right: mapExpr(node.right) };
    case "if":
      return { ...node, test: mapExpr(node.test) };
    case "for":
      return { ...node, from: mapExpr(node.from) };
    case "for_range":
      return { ...node, length: mapExpr(node.length) };
    case "for_of":
      return { ...node, iterable: mapExpr(node.iterable) };
    case "append":
      return { ...node, value: mapExpr(node.value) };
    case "return":
      return { ...node, value: mapExpr(node.value) };
    case "block":
    case "sort_by_key":
      return node;
  }
}

/**
 * Rebuilds a node with every nested statement list passed through `mapNodes`.
 * Leaf statements are returned unchanged, so optimizer passes can recurse
 * into new container kinds without enumerating them individually.
 */
export function mapNodeBodies(node: IRNode, mapNodes: (nodes: readonly IRNode[]) => readonly IRNode[]): IRNode {
  switch (node.kind) {
    case "block":
      return { ...node, body: mapNodes(node.body) };
    case "if":
      return {
        ...node,
        then: mapNodes(node.then),
        ...(node.otherwise ? { otherwise: mapNodes(node.otherwise) } : {}),
      };
    case "for":
    case "for_range":
    case "for_of":
    case "map_equal":
    case "binary_search_equal":
      return { ...node, body: mapNodes(node.body) };
    default:
      return node;
  }
}
