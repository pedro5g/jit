import * as ATS from "../../../core/ats/index.js";
import { resolveWrappers } from "../../resolvers/resolve-wrappers.js";
import { type EqualStrategy, resolveEqualStrategy } from "../../strategy/resolve-strategy.js";
import {
  add,
  call,
  type IRExpr,
  type IRNode,
  type IRProgram,
  irVar,
  literal,
  loadIndex,
  loadProp,
  not,
  notStrictEqual,
  sameNumber,
  sameValue,
  strictEqual,
} from "../ir.js";
import { Scope } from "../scope.js";

type EqualSchema = ATS.AnyTypeSchema & { readonly def: Record<string, unknown> };

export function buildEqualIR(
  schema: ATS.AnyTypeSchema,
  strategy: EqualStrategy = resolveEqualStrategy(schema)
): IRProgram {
  const scope = new Scope();
  const left = irVar("l");
  const right = irVar("r");
  const body: IRNode[] = [
    { kind: "if", test: sameValue(left, right), then: [{ kind: "return", value: literal(true) }] },
  ];

  if (strategy.hash.type === "hash-short-circuit") {
    body.push({
      kind: "hash_compare",
      leftHash: buildHashExpr(schema as EqualSchema, left),
      rightHash: buildHashExpr(schema as EqualSchema, right),
    });
  }

  appendSchemaCompare(body, schema as EqualSchema, left, right, scope, strategy);
  body.push({ kind: "return", value: literal(true) });

  return {
    kind: "program",
    params: [left, right],
    body,
  };
}

function appendSchemaCompare(
  body: IRNode[],
  schema: EqualSchema,
  left: IRExpr,
  right: IRExpr,
  scope: Scope,
  strategy: EqualStrategy
): void {
  const resolved = resolveWrappers(schema);

  if (resolved.optional || resolved.nullable) {
    appendResolvedWrapperCompare(body, resolved, left, right, scope, strategy);
    return;
  }

  const base = resolved.base as EqualSchema;

  switch (base.type) {
    case ATS.TypeName.any:
    case ATS.TypeName.unknown:
    case ATS.TypeName.never:
    case ATS.TypeName.void:
    case ATS.TypeName.undefined:
    case ATS.TypeName.literal:
    case ATS.TypeName.enum:
    case ATS.TypeName.file:
      appendCompareOrFail(body, sameValue(left, right));
      return;
    case ATS.TypeName.nan:
    case ATS.TypeName.int:
    case ATS.TypeName.number:
      appendCompareOrFail(body, sameNumber(left, right));
      return;
    case ATS.TypeName.null:
    case ATS.TypeName.symbol:
    case ATS.TypeName.boolean:
    case ATS.TypeName.bigint:
    case ATS.TypeName.string:
      appendCompareOrFail(body, strictEqual(left, right));
      return;
    case ATS.TypeName.date:
      appendCompareOrFail(body, sameValue(call(loadProp(left, "getTime")), call(loadProp(right, "getTime"))));
      return;
    case ATS.TypeName.array:
      appendArrayCompare(body, base, left, right, scope, strategy);
      return;
    case ATS.TypeName.object:
      appendObjectCompare(body, base, left, right, scope);
      return;
    default:
      throw new Error(`[JIT] Unimplemented compiler equal IR for type: ${base.type}`);
  }
}

function appendCompareOrFail(body: IRNode[], expr: IRExpr): void {
  body.push({ kind: "if", test: not(expr), then: [{ kind: "return", value: literal(false) }] });
}

function appendResolvedWrapperCompare(
  body: IRNode[],
  resolved: { readonly base: ATS.AnyTypeSchema; readonly optional: boolean; readonly nullable: boolean },
  left: IRExpr,
  right: IRExpr,
  scope: Scope,
  strategy: EqualStrategy
): void {
  const inner: IRNode[] = [];

  if (resolved.optional) {
    inner.push({
      kind: "if",
      test: orCompare(strictEqual(left, literal(undefined)), strictEqual(right, literal(undefined))),
      then: [{ kind: "return", value: literal(false) }],
    });
  }

  if (resolved.nullable) {
    inner.push({
      kind: "if",
      test: orCompare(strictEqual(left, literal(null)), strictEqual(right, literal(null))),
      then: [{ kind: "return", value: literal(false) }],
    });
  }

  appendSchemaCompare(inner, resolved.base as EqualSchema, left, right, scope, strategy);
  body.push({ kind: "if", test: not(sameValue(left, right)), then: inner });
}

function appendArrayCompare(
  body: IRNode[],
  schema: EqualSchema,
  left: IRExpr,
  right: IRExpr,
  scope: Scope,
  strategy: EqualStrategy
): void {
  const len = scope.createVar("len");
  const ix = scope.createVar("i");
  const leftItem = scope.createVar("li");
  const rightItem = scope.createVar("ri");
  const loopBody: IRNode[] = [
    { kind: "assign", target: leftItem, expr: loadIndex(left, ix) },
    { kind: "assign", target: rightItem, expr: loadIndex(right, ix) },
  ];

  appendSchemaCompare(loopBody, schema.def.element as EqualSchema, leftItem, rightItem, scope, strategy);

  if (strategy.array.type === "map") {
    body.push({
      kind: "map_equal",
      left,
      right,
      key: strategy.array.key,
      length: len,
      index: ix,
      leftItem,
      rightItem,
      rightIndex: scope.createVar("rightIndex"),
      body: loopBody.slice(2),
    });
    return;
  }

  if (strategy.array.type === "binary-search") {
    body.push({
      kind: "binary_search_equal",
      left,
      right,
      key: strategy.array.key,
      length: len,
      index: ix,
      leftItem,
      rightItem,
      searchLow: scope.createVar("low"),
      searchHigh: scope.createVar("high"),
      searchMid: scope.createVar("mid"),
      found: scope.createVar("found"),
      direction: strategy.array.direction,
      body: loopBody.slice(2),
    });
    return;
  }

  body.push(
    { kind: "assign", target: len, expr: loadProp(left, "length") },
    {
      kind: "if",
      test: notStrictEqual(len, loadProp(right, "length")),
      then: [{ kind: "return", value: literal(false) }],
    },
    { kind: "for", index: ix, from: len, body: loopBody }
  );
}

function appendObjectCompare(body: IRNode[], schema: EqualSchema, left: IRExpr, right: IRExpr, scope: Scope): void {
  const props = schema.def.props as Record<string, EqualSchema>;

  for (const key of Object.keys(props)) {
    const leftValue = scope.createVar(`l_${key}`);
    const rightValue = scope.createVar(`r_${key}`);

    body.push(
      { kind: "assign", target: leftValue, expr: loadProp(left, key) },
      { kind: "assign", target: rightValue, expr: loadProp(right, key) }
    );
    appendSchemaCompare(body, props[key], leftValue, rightValue, scope, {
      type: "equal",
      array: { type: "loop" },
      hash: { type: "none" },
    });
  }
}

function orCompare(left: IRExpr, right: IRExpr): IRExpr {
  return { kind: "binary", op: "or", left, right };
}

function buildHashExpr(schema: EqualSchema, value: IRExpr): IRExpr {
  const resolved = resolveWrappers(schema);
  const base = resolved.base as EqualSchema;

  if (base.type === ATS.TypeName.object) {
    let expr: IRExpr = literal("object");
    const props = base.def.props as Record<string, EqualSchema>;

    for (const key of Object.keys(props)) {
      expr = add(add(expr, literal("|")), loadProp(value, key));
    }

    return expr;
  }

  if (base.type === ATS.TypeName.array) {
    return loadProp(value, "length");
  }

  return value;
}
