import type {
  QueryAggregateNode,
  QueryConditionNode,
  QueryMutationNode,
  QuerySelectFieldsNode,
  QueryValueNode,
} from "../../../core/ast/index.js";
import { JITError } from "../../../errors/index.js";
import type { OptimizedQueryPlan, QueryObjectSchema, QueryTarget } from "../../query.js";
import {
  allOf,
  append,
  arrayLiteral,
  binary,
  call,
  construct,
  exprStmt,
  forOf,
  forRange,
  type IRExpr,
  type IRLiteralValue,
  type IRNode,
  type IRProgram,
  irVar,
  letDecl,
  literal,
  loadIndex,
  loadProp,
  not,
  objectLiteral,
  sortByKey,
  store,
  strictEqual,
} from "../ir.js";

// The query skeleton uses fixed, non-colliding variable names on purpose:
// generated sources stay identical to hand-written loops and stable across
// compiles, which the golden-source tests rely on.
const VALUE = irVar("value");
const PARAMS = irVar("params");
const LEN = irVar("len");
const OUT = irVar("out");
const CURSOR = irVar("j");
const INDEX = irVar("i");
const ITEM = irVar("item");
const ENTRY = irVar("entry");
const SEEN = irVar("seen");
const UNIQUE_KEY = irVar("uniqueKey");
const COLLECT_KEY = irVar("collectKey");
const GROUP = irVar("group");
const PROJECTED = irVar("projected");

const COMPARE_OPERATORS = {
  eq: "strictEqual",
  neq: "notStrictEqual",
  gt: "greaterThan",
  gte: "greaterThanOrEqual",
  lt: "lessThan",
  lte: "lessThanOrEqual",
} as const;

export interface BuildQueryIROptions {
  readonly hasParams?: boolean;
}

export function buildQueryIR(
  target: QueryTarget,
  plan: OptimizedQueryPlan,
  options: BuildQueryIROptions = {}
): IRProgram {
  const body = plan.mutation
    ? buildMutationQuery(target, plan)
    : plan.aggregate
      ? buildAggregateQuery(target, plan, plan.aggregate)
      : plan.collector
        ? buildCollectedQuery(target, plan)
        : buildArrayQuery(target, plan);

  return { kind: "program", params: options.hasParams ? [VALUE, PARAMS] : [VALUE], body };
}

function buildArrayQuery(target: QueryTarget, plan: OptimizedQueryPlan): readonly IRNode[] {
  if (shouldProjectAfterOrder(plan)) return buildArrayQueryWithPostOrderProjection(target, plan);

  const selected = buildProjection(plan.select);
  const body: IRNode[] = [
    ...buildLoopHeader(target, plan, construct("Array", [LEN])),
    letDecl(CURSOR, literal(0)),
    buildInputLoop(target, buildGuardedBody(plan, [append(OUT, CURSOR, selected)])),
    store(loadProp(OUT, "length"), CURSOR),
  ];

  if (plan.orderBy) body.push(sortByKey(OUT, plan.orderBy.key, plan.orderBy.direction));

  body.push({ kind: "return", value: OUT });
  return body;
}

function buildArrayQueryWithPostOrderProjection(target: QueryTarget, plan: OptimizedQueryPlan): readonly IRNode[] {
  const orderBy = plan.orderBy;
  const body: IRNode[] = [
    ...buildLoopHeader(target, plan, construct("Array", [LEN])),
    letDecl(CURSOR, literal(0)),
    buildInputLoop(target, buildGuardedBody(plan, [append(OUT, CURSOR, ITEM)])),
    store(loadProp(OUT, "length"), CURSOR),
  ];

  if (orderBy) body.push(sortByKey(OUT, orderBy.key, orderBy.direction));

  body.push(
    { kind: "assign", target: PROJECTED, expr: construct("Array", [CURSOR]) },
    forRange(INDEX, CURSOR, [
      { kind: "assign", target: ITEM, expr: loadIndex(OUT, INDEX) },
      store(loadIndex(PROJECTED, INDEX), buildProjection(plan.select)),
    ]),
    { kind: "return", value: PROJECTED }
  );
  return body;
}

function buildCollectedQuery(target: QueryTarget, plan: OptimizedQueryPlan): readonly IRNode[] {
  const collector = plan.collector;

  if (!collector) return [];

  const selected = buildProjection(plan.select);
  const collect: IRNode[] = [{ kind: "assign", target: COLLECT_KEY, expr: loadProp(ITEM, collector.key) }];

  if (collector.kind === "keyed") {
    collect.push(exprStmt(call(loadProp(OUT, "set"), [COLLECT_KEY, selected])));
  } else {
    collect.push(
      letDecl(GROUP, loadIndex(OUT, COLLECT_KEY)),
      {
        kind: "if",
        test: strictEqual(GROUP, literal(undefined)),
        then: [store(GROUP, arrayLiteral()), store(loadIndex(OUT, COLLECT_KEY), GROUP)],
      },
      store(loadIndex(GROUP, loadProp(GROUP, "length")), selected)
    );
  }

  const outInitializer =
    collector.kind === "keyed" ? construct("Map") : call(loadProp(irVar("Object"), "create"), [literal(null)]);

  return [
    ...buildLoopHeader(target, plan, outInitializer),
    buildInputLoop(target, buildGuardedBody(plan, collect)),
    { kind: "return", value: OUT },
  ];
}

const ACC = irVar("acc");
const ACC_COUNT = irVar("n");

function buildAggregateQuery(
  target: QueryTarget,
  plan: OptimizedQueryPlan,
  aggregate: QueryAggregateNode
): readonly IRNode[] {
  const body: IRNode[] = [];

  if (target.kind === "array") {
    body.push({ kind: "assign", target: LEN, expr: loadProp(VALUE, "length") });
  }
  if (plan.unique) body.push({ kind: "assign", target: SEEN, expr: construct("Set") });

  const field = aggregate.key === undefined ? ITEM : loadProp(ITEM, aggregate.key);

  switch (aggregate.op) {
    case "sum":
    case "count": {
      const increment = aggregate.op === "count" ? literal(1) : field;

      body.push(
        letDecl(ACC, literal(0)),
        buildInputLoop(target, buildGuardedBody(plan, [store(ACC, binary("add", ACC, increment))])),
        { kind: "return", value: ACC }
      );
      return body;
    }
    case "avg":
      body.push(
        letDecl(ACC, literal(0)),
        letDecl(ACC_COUNT, literal(0)),
        buildInputLoop(
          target,
          buildGuardedBody(plan, [
            store(ACC, binary("add", ACC, field)),
            store(ACC_COUNT, binary("add", ACC_COUNT, literal(1))),
          ])
        ),
        {
          kind: "if",
          test: strictEqual(ACC_COUNT, literal(0)),
          then: [{ kind: "return", value: literal(undefined) }],
        },
        { kind: "return", value: binary("divide", ACC, ACC_COUNT) }
      );
      return body;
    case "min":
    case "max": {
      const wins = binary(aggregate.op === "min" ? "lessThan" : "greaterThan", field, ACC);

      body.push(
        letDecl(ACC),
        buildInputLoop(
          target,
          buildGuardedBody(plan, [
            {
              kind: "if",
              test: { kind: "nary", op: "or", operands: [strictEqual(ACC, literal(undefined)), wins] },
              then: [store(ACC, field)],
            },
          ])
        ),
        { kind: "return", value: ACC }
      );
      return body;
    }
  }
}

function buildMutationQuery(target: QueryTarget, plan: OptimizedQueryPlan): readonly IRNode[] {
  const mutation = plan.mutation;

  if (!mutation) return [];

  const condition = buildFilterTest(plan);
  const test = condition ?? literal(false);
  const loopBody: IRNode[] =
    mutation.kind === "delete"
      ? [{ kind: "if", test: not(test), then: buildMutationKeep(target, ITEM) }]
      : [
          {
            kind: "if",
            test,
            then: buildMutationKeep(target, buildPatchObject(target.objectSchema, mutation)),
            otherwise: buildMutationKeep(target, ITEM),
          },
        ];

  const outInitializer =
    target.kind === "array" ? construct("Array", [LEN]) : target.kind === "set" ? construct("Set") : construct("Map");
  const body: IRNode[] = [...buildLoopHeader(target, plan, outInitializer)];

  if (target.kind === "array") body.push(letDecl(CURSOR, literal(0)));
  body.push(buildInputLoop(target, loopBody));
  if (target.kind === "array") body.push(store(loadProp(OUT, "length"), CURSOR));
  body.push({ kind: "return", value: OUT });
  return body;
}

function buildMutationKeep(target: QueryTarget, value: IRExpr): readonly IRNode[] {
  switch (target.kind) {
    case "array":
      return [append(OUT, CURSOR, value)];
    case "set":
      return [exprStmt(call(loadProp(OUT, "add"), [value]))];
    case "map":
      return [exprStmt(call(loadProp(OUT, "set"), [loadIndex(ENTRY, literal(0)), value]))];
  }
}

function buildPatchObject(schema: QueryObjectSchema, mutation: QueryMutationNode): IRExpr {
  if (mutation.kind !== "update") return ITEM;

  const entries = Object.keys(schema.def.props).map((key) => {
    const binding = mutation.patch[key];

    return { key, value: binding ? irVar(binding.name) : loadProp(ITEM, key) };
  });

  return objectLiteral(entries);
}

function buildLoopHeader(target: QueryTarget, plan: OptimizedQueryPlan, outInitializer: IRExpr): readonly IRNode[] {
  const header: IRNode[] = [
    { kind: "assign", target: LEN, expr: loadProp(VALUE, target.kind === "array" ? "length" : "size") },
  ];

  if (plan.unique) header.push({ kind: "assign", target: SEEN, expr: construct("Set") });
  header.push({ kind: "assign", target: OUT, expr: outInitializer });
  return header;
}

function buildInputLoop(target: QueryTarget, body: readonly IRNode[]): IRNode {
  switch (target.kind) {
    case "array":
      return forRange(INDEX, LEN, [{ kind: "assign", target: ITEM, expr: loadIndex(VALUE, INDEX) }, ...body]);
    case "set":
      return forOf(ITEM, VALUE, body);
    case "map":
      return forOf(ENTRY, VALUE, [{ kind: "assign", target: ITEM, expr: loadIndex(ENTRY, literal(1)) }, ...body]);
  }
}

function buildGuardedBody(plan: OptimizedQueryPlan, accepted: readonly IRNode[]): readonly IRNode[] {
  const unique = plan.unique;
  const inner: readonly IRNode[] = unique
    ? [
        { kind: "assign", target: UNIQUE_KEY, expr: loadProp(ITEM, unique.key) },
        {
          kind: "if",
          test: not(call(loadProp(SEEN, "has"), [UNIQUE_KEY])),
          then: [exprStmt(call(loadProp(SEEN, "add"), [UNIQUE_KEY])), ...accepted],
        },
      ]
    : accepted;
  const condition = buildFilterTest(plan);

  return condition ? [{ kind: "if", test: condition, then: inner }] : inner;
}

function buildFilterTest(plan: OptimizedQueryPlan): IRExpr | undefined {
  if (plan.filters.length === 0) return undefined;

  return allOf(plan.filters.map((filter) => buildCondition(filter.condition)));
}

function buildCondition(condition: QueryConditionNode): IRExpr {
  switch (condition.kind) {
    case "compare":
      return binary(COMPARE_OPERATORS[condition.op], buildValue(condition.left), buildValue(condition.right));
    case "logical":
      return {
        kind: "nary",
        op: condition.op,
        operands: [buildCondition(condition.left), buildCondition(condition.right)],
      };
    case "not":
      return not(buildCondition(condition.inner));
  }
}

function buildValue(value: QueryValueNode): IRExpr {
  switch (value.kind) {
    case "field":
      return loadProp(ITEM, value.key);
    case "binding":
      return irVar(value.name);
    case "param":
      return loadProp(PARAMS, value.name);
    case "literal":
      return literal(expectSafeLiteral(value.value));
  }
}

function expectSafeLiteral(value: unknown): IRLiteralValue {
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "bigint" ||
    typeof value === "boolean" ||
    value === null ||
    value === undefined
  ) {
    return value;
  }

  throw new JITError("INVALID_QUERY", "query literal values must be primitive compiler literals");
}

function buildProjection(select: QuerySelectFieldsNode | undefined): IRExpr {
  if (!select) return ITEM;

  return objectLiteral(select.fields.map((field) => ({ key: field, value: loadProp(ITEM, field) })));
}

function shouldProjectAfterOrder(plan: OptimizedQueryPlan): boolean {
  return Boolean(plan.select && plan.orderBy && !plan.select.fields.includes(plan.orderBy.key));
}
