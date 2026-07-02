export interface IRVar {
  readonly kind: "var";
  readonly name: string;
}

export type IRLiteralValue = string | number | bigint | boolean | null | undefined;

export type IRExpr =
  | IRVar
  | { readonly kind: "literal"; readonly value: IRLiteralValue }
  | { readonly kind: "not"; readonly expr: IRExpr }
  | {
      readonly kind: "binary";
      readonly op: "strictEqual" | "notStrictEqual" | "or" | "add";
      readonly left: IRExpr;
      readonly right: IRExpr;
    }
  | { readonly kind: "sameValue"; readonly left: IRExpr; readonly right: IRExpr }
  | { readonly kind: "sameNumber"; readonly left: IRExpr; readonly right: IRExpr }
  | { readonly kind: "load_prop"; readonly base: IRExpr; readonly key: string }
  | { readonly kind: "load_index"; readonly base: IRExpr; readonly index: IRExpr }
  | { readonly kind: "call"; readonly callee: IRExpr; readonly args: readonly IRExpr[] };

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
  | { readonly kind: "return"; readonly value: IRExpr };

export interface IRProgram {
  readonly kind: "program";
  readonly params: readonly [IRVar, IRVar];
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

export function loadProp(base: IRExpr, key: string): IRExpr {
  return { kind: "load_prop", base, key };
}

export function loadIndex(base: IRExpr, index: IRExpr): IRExpr {
  return { kind: "load_index", base, index };
}

export function call(callee: IRExpr, args: readonly IRExpr[] = []): IRExpr {
  return { kind: "call", callee, args };
}
